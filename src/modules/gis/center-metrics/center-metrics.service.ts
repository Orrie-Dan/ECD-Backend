import { AttendanceStatus, ChildStatus } from '../../../common/domain';
import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  centerIdWhere,
  childCenterWhere,
  resolveDistrictQueryScope,
  resolveInclusiveDateRange,
  type DistrictQueryScope,
} from '../../../common/scope/district-query.scope';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuthUser } from '../../auth/interfaces/jwt-payload.interface';
import { toDateOnlyString } from '../../nutrition/who/concern';
import {
  STUNTING_MIN_SCREENED,
  buildCenterMetricItems,
  tallyStuntingByCenter,
} from './center-metrics.calc';
import { CenterDirectoryCache } from './center-directory.cache';
import { CenterMetricsQueryDto } from './center-metrics-query.dto';
import { CenterMetricsResponseDto } from './center-metrics-response.dto';

const DEFAULT_RANGE_DAYS = 89;
const MAX_RANGE_DAYS = 366;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Per-center aggregates for the ECD map (enrollment, attendance, latest self-evaluation,
 * stunting). National, province, district or narrower scope; never returns child-level rows.
 */
@Injectable()
export class CenterMetricsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly directory: CenterDirectoryCache,
  ) {}

  async centerMetrics(
    user: AuthUser,
    query: CenterMetricsQueryDto,
  ): Promise<CenterMetricsResponseDto> {
    // District/sector users are pinned to their assignment; NCDA may query nationally.
    const scope = await resolveDistrictQueryScope(this.prisma, user, query);

    const { from, to } = resolveInclusiveDateRange(query.from, query.to, DEFAULT_RANGE_DAYS);
    if ((to.getTime() - from.getTime()) / DAY_MS > MAX_RANGE_DAYS) {
      throw new BadRequestException(`Date range cannot exceed ${MAX_RANGE_DAYS} days`);
    }

    const base = {
      from: from.toISOString(),
      to: to.toISOString(),
      districtId: scope.districtId,
      sectorId: scope.sectorId,
      stuntingMinScreened: STUNTING_MIN_SCREENED,
    };

    if (scope.centerIds !== 'all' && scope.centerIds.length === 0) {
      return { ...base, items: [], unmappedCount: 0 };
    }

    const cWhere = centerIdWhere(scope);
    const childWhere = childCenterWhere(scope);

    const [centers, enrolledRows, attendanceRows, selfEvalByCenter, heightRows] = await Promise.all(
      [
        // Cached directory — the per-request row transfer was the endpoint's main cost.
        this.directory.centersFor(scope),
        this.prisma.child.groupBy({
          by: ['centerId'],
          where: { deletedAt: null, status: ChildStatus.active, ...childWhere },
          _count: { _all: true },
        }),
        this.prisma.attendanceRecord.groupBy({
          by: ['centerId', 'status'],
          where: { deletedAt: null, attendanceDate: { gte: from, lte: to }, ...cWhere },
          _count: { _all: true },
        }),
        this.latestSelfEvaluations(scope),
        this.latestHeightScreenings(scope, from, to),
      ],
    );

    const presentByCenter = new Map<string, number>();
    const absentByCenter = new Map<string, number>();
    for (const row of attendanceRows) {
      if (row.status === AttendanceStatus.present)
        presentByCenter.set(row.centerId, row._count._all);
      else if (row.status === AttendanceStatus.absent)
        absentByCenter.set(row.centerId, row._count._all);
    }

    const { items, unmappedCount } = buildCenterMetricItems({
      centers,
      enrolledByCenter: new Map(enrolledRows.map((r) => [r.centerId, r._count._all])),
      presentByCenter,
      absentByCenter,
      selfEvalByCenter,
      stuntingByCenter: tallyStuntingByCenter(heightRows),
    });

    return { ...base, items, unmappedCount };
  }

  /** Raw-SQL center filter on alias `c` (ecd_center); mirrors {@link ecdCenterWhere}. */
  private centerScopeSql(scope: DistrictQueryScope): Prisma.Sql {
    if (scope.centerIds !== 'all') {
      return Prisma.sql`c.id IN (${Prisma.join(scope.centerIds)})`;
    }
    if (scope.districtId) {
      return Prisma.sql`c.district_id = ${scope.districtId}`;
    }
    if (scope.provinceId) {
      return Prisma.sql`c.district_id IN (SELECT d.id FROM district d WHERE d.province_id = ${scope.provinceId})`;
    }
    return Prisma.sql`TRUE`;
  }

  /** Latest submitted/verified self-assessment per center, regardless of date range. */
  private async latestSelfEvaluations(scope: DistrictQueryScope) {
    const rows = await this.prisma.$queryRaw<
      Array<{
        center_id: string;
        overall_percent: Prisma.Decimal | number | string | null;
        overall_rank: string | null;
        assessment_date: Date;
      }>
    >`
      /* gis_center_metrics_latest_self_evals */
      SELECT DISTINCT ON (a.center_id)
        a.center_id,
        a.overall_percent,
        a.overall_rank,
        a.assessment_date
      FROM compliance_assessment a
      INNER JOIN ecd_center c ON c.id = a.center_id
      WHERE a.deleted_at IS NULL
        AND a.assessment_type = 'self_assessment'
        AND a.status IN ('submitted', 'verified')
        AND c.deleted_at IS NULL
        AND ${this.centerScopeSql(scope)}
      ORDER BY a.center_id, a.assessment_date DESC, a.created_at DESC
    `;

    return new Map(
      rows.map((r) => [
        r.center_id,
        {
          percent: r.overall_percent == null ? null : Number(r.overall_percent),
          rank: r.overall_rank,
          date: toDateOnlyString(r.assessment_date),
        },
      ]),
    );
  }

  /** One row per child: their latest screening in range that has a height measurement. */
  private async latestHeightScreenings(scope: DistrictQueryScope, from: Date, to: Date) {
    const rows = await this.prisma.$queryRaw<
      Array<{
        center_id: string;
        date_of_birth: Date | null;
        gender: string | null;
        screening_date: Date;
        height_cm: Prisma.Decimal | number | string | null;
      }>
    >`
      /* gis_center_metrics_latest_height */
      SELECT DISTINCT ON (s.child_id)
        ch.center_id,
        ch.date_of_birth,
        ch.gender,
        s.screening_date,
        s.height_cm
      FROM child_nutrition_screening s
      INNER JOIN child ch ON ch.id = s.child_id
      INNER JOIN ecd_center c ON c.id = ch.center_id
      WHERE s.deleted_at IS NULL
        AND s.height_cm IS NOT NULL
        AND s.screening_date >= ${from}
        AND s.screening_date <= ${to}
        AND ch.deleted_at IS NULL
        AND c.deleted_at IS NULL
        AND ${this.centerScopeSql(scope)}
      ORDER BY s.child_id, s.screening_date DESC, s.created_at DESC
    `;

    return rows.map((r) => ({
      centerId: r.center_id,
      dateOfBirth: r.date_of_birth,
      gender: r.gender,
      screeningDate: r.screening_date,
      heightCm: r.height_cm == null ? null : Number(r.height_cm),
    }));
  }
}

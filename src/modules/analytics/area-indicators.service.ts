import { ChildStatus, UserRole } from '../../common/domain';
import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { assertDistrictAccess } from '../../common/auth/scope.util';
import { resolveInclusiveDateRange } from '../../common/scope/district-query.scope';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../auth/interfaces/jwt-payload.interface';
import { screeningCompatBand } from '../nutrition/who/concern';
import { centerAreaCte } from './center-area.sql';
import { computeStedCoveragePct, roundPercent, roundRate } from './district-risk.policy';
import { AreaIndicatorsQueryDto, type AreaIndicatorLevel } from './dto/area-indicators-query.dto';
import {
  AreaIndicatorItemDto,
  AreaIndicatorsResponseDto,
} from './dto/area-indicators-response.dto';

type Numeric = Prisma.Decimal | number | string | null;
const toNumber = (value: Numeric) => (value == null ? null : Number(value));

type AreaRow = {
  areaId: string;
  areaName: string;
  areaCode: string;
  districtId: string | null;
  districtName: string | null;
  latitude: number | null;
  longitude: number | null;
};

type CountRow = { areaId: string; cnt: number };

/**
 * District-risk indicators (attendance, severe nutrition, open referrals, STED
 * coverage) per sector or per ECD center, attributed to the area where the
 * center is located. Lets the monitoring map recolour as the user zooms in;
 * definitions match {@link DistrictRiskService} so the grains agree.
 * Only areas with at least one center in scope are returned.
 */
@Injectable()
export class AreaIndicatorsService {
  constructor(private readonly prisma: PrismaService) {}

  async getAreaIndicators(
    user: AuthUser,
    query: AreaIndicatorsQueryDto,
  ): Promise<AreaIndicatorsResponseDto> {
    const level: AreaIndicatorLevel = query.level ?? 'sector';
    const districtId = this.resolveDistrictFilter(user, query);
    const sectorId = query.sectorId ?? null;
    const { from, to } = resolveInclusiveDateRange(query.from, query.to);

    const cte = centerAreaCte(level, districtId, sectorId);
    const [areas, children, attendance, nutrition, referrals, sted, selfEval] = await Promise.all([
      this.loadAreas(level, cte),
      this.activeChildrenByArea(cte),
      this.attendanceByArea(cte, from, to),
      this.nutritionByArea(cte, from, to),
      this.pendingReferralsByArea(cte),
      this.stedByArea(cte, from, to),
      this.selfEvalByArea(cte),
    ]);

    const childrenBy = new Map(children.map((r) => [r.areaId, r.cnt]));
    const attendanceBy = new Map(attendance.map((r) => [r.areaId, r]));
    const referralsBy = new Map(referrals.map((r) => [r.areaId, r.cnt]));
    const stedBy = new Map(sted.map((r) => [r.areaId, r.cnt]));
    const selfEvalBy = new Map(selfEval.map((r) => [r.areaId, r]));

    const items: AreaIndicatorItemDto[] = areas.map((area) => {
      const activeChildren = childrenBy.get(area.areaId) ?? 0;
      const att = attendanceBy.get(area.areaId) ?? { present: 0, absent: 0 };
      const attendanceRecords = att.present + att.absent;
      const nut = nutrition.get(area.areaId) ?? { screenings: 0, severe: 0 };
      const stedChildrenAssessed = stedBy.get(area.areaId) ?? 0;
      const selfEvalRow = selfEvalBy.get(area.areaId);
      return {
        ...area,
        activeChildren,
        attendanceRate: roundRate(att.present, attendanceRecords),
        attendanceRecords,
        severeNutritionCount: nut.severe,
        nutritionScreenings: nut.screenings,
        pendingReferralCount: referralsBy.get(area.areaId) ?? 0,
        stedChildrenAssessed,
        stedCoverage: computeStedCoveragePct(stedChildrenAssessed, activeChildren),
        selfEvalPercent: roundPercent(toNumber(selfEvalRow?.avgPercent ?? null)),
        selfEvalCentersEvaluated: selfEvalRow?.cnt ?? 0,
      };
    });
    items.sort((a, b) => a.areaName.localeCompare(b.areaName));

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      level,
      districtId,
      sectorId,
      items,
      total: items.length,
    };
  }

  /** NCDA: optional district; district focal person: pinned. Everyone else → 403. */
  private resolveDistrictFilter(user: AuthUser, query: AreaIndicatorsQueryDto): string | null {
    if (user.role === UserRole.ncda_admin) {
      return query.districtId ?? null;
    }
    if (user.role === UserRole.district_focal_person) {
      if (!user.districtId) {
        throw new ForbiddenException('District scope is required');
      }
      if (query.districtId && query.districtId !== user.districtId) {
        assertDistrictAccess(user, query.districtId);
      }
      return user.districtId;
    }
    throw new ForbiddenException(
      'Area indicators are available to NCDA and district focal persons only',
    );
  }

  private async loadAreas(level: AreaIndicatorLevel, cte: Prisma.Sql): Promise<AreaRow[]> {
    if (level === 'center') {
      return this.prisma.$queryRaw<AreaRow[]>`
        /* analytics_area_indicators_centers */
        ${cte}
        SELECT
          c.id AS "areaId", c.name AS "areaName", c.code AS "areaCode",
          d.id AS "districtId", d.name AS "districtName",
          c.latitude AS latitude, c.longitude AS longitude
        FROM center_area ca
        INNER JOIN ecd_center c ON c.id = ca.center_id
        LEFT JOIN district d ON d.id = c.district_id
      `;
    }
    return this.prisma.$queryRaw<AreaRow[]>`
      /* analytics_area_indicators_sectors */
      ${cte}
      SELECT
        u.id AS "areaId", u.name AS "areaName", u.code AS "areaCode",
        d.id AS "districtId", d.name AS "districtName",
        NULL::double precision AS latitude, NULL::double precision AS longitude
      FROM center_area ca
      INNER JOIN administrative_unit u ON u.id = ca.area_id
      INNER JOIN ecd_center c ON c.id = ca.center_id
      LEFT JOIN district d ON d.id = c.district_id
      GROUP BY u.id, u.name, u.code, d.id, d.name
    `;
  }

  private async activeChildrenByArea(cte: Prisma.Sql): Promise<CountRow[]> {
    return this.prisma.$queryRaw<CountRow[]>`
      /* analytics_area_indicators_children */
      ${cte}
      SELECT ca.area_id AS "areaId", COUNT(ch.id)::int AS cnt
      FROM child ch
      INNER JOIN center_area ca ON ca.center_id = ch.center_id
      WHERE ch.deleted_at IS NULL AND ch.status = ${ChildStatus.active}
      GROUP BY ca.area_id
    `;
  }

  private async attendanceByArea(
    cte: Prisma.Sql,
    from: Date,
    to: Date,
  ): Promise<Array<{ areaId: string; present: number; absent: number }>> {
    return this.prisma.$queryRaw<Array<{ areaId: string; present: number; absent: number }>>`
      /* analytics_area_indicators_attendance */
      ${cte}
      SELECT
        ca.area_id AS "areaId",
        SUM(CASE WHEN ar.status = ${'present'} THEN 1 ELSE 0 END)::int AS present,
        SUM(CASE WHEN ar.status = ${'absent'} THEN 1 ELSE 0 END)::int AS absent
      FROM attendance_record ar
      INNER JOIN center_area ca ON ca.center_id = ar.center_id
      WHERE ar.deleted_at IS NULL
        AND ar.attendance_date >= ${from}
        AND ar.attendance_date <= ${to}
      GROUP BY ca.area_id
    `;
  }

  /** Screenings in range; severe = any WHO indicator below −3 SD (district-risk semantics). */
  private async nutritionByArea(
    cte: Prisma.Sql,
    from: Date,
    to: Date,
  ): Promise<Map<string, { screenings: number; severe: number }>> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        areaId: string;
        dateOfBirth: Date | null;
        gender: string | null;
        screeningDate: Date;
        weightKg: Numeric;
        heightCm: Numeric;
        muacCm: Numeric;
      }>
    >`
      /* analytics_area_indicators_nutrition */
      ${cte}
      SELECT
        ca.area_id AS "areaId", ch.date_of_birth AS "dateOfBirth", ch.gender,
        s.screening_date AS "screeningDate", s.weight_kg AS "weightKg",
        s.height_cm AS "heightCm", s.muac_cm AS "muacCm"
      FROM child_nutrition_screening s
      INNER JOIN child ch ON ch.id = s.child_id
      INNER JOIN center_area ca ON ca.center_id = ch.center_id
      WHERE s.deleted_at IS NULL
        AND ch.deleted_at IS NULL
        AND s.screening_date >= ${from}
        AND s.screening_date <= ${to}
    `;

    const byArea = new Map<string, { screenings: number; severe: number }>();
    for (const row of rows) {
      const cur = byArea.get(row.areaId) ?? { screenings: 0, severe: 0 };
      cur.screenings += 1;
      const band = screeningCompatBand({
        dateOfBirth: row.dateOfBirth,
        gender: row.gender,
        screeningDate: row.screeningDate,
        weightKg: toNumber(row.weightKg),
        heightCm: toNumber(row.heightCm),
        muacCm: toNumber(row.muacCm),
      });
      if (band === 'severe') cur.severe += 1;
      byArea.set(row.areaId, cur);
    }
    return byArea;
  }

  /** Open pipeline — not limited by the selected period (matches district-risk). */
  private async pendingReferralsByArea(cte: Prisma.Sql): Promise<CountRow[]> {
    return this.prisma.$queryRaw<CountRow[]>`
      /* analytics_area_indicators_referrals */
      ${cte}
      SELECT ca.area_id AS "areaId", COUNT(r.id)::int AS cnt
      FROM referral r
      INNER JOIN center_area ca ON ca.center_id = r.center_id
      WHERE r.deleted_at IS NULL
        AND r.status = CAST(${'pending'} AS referral_status)
      GROUP BY ca.area_id
    `;
  }

  /** Distinct children with a STED assessment in range. */
  private async stedByArea(cte: Prisma.Sql, from: Date, to: Date): Promise<CountRow[]> {
    return this.prisma.$queryRaw<CountRow[]>`
      /* analytics_area_indicators_sted */
      ${cte}
      SELECT ca.area_id AS "areaId", COUNT(DISTINCT s.child_id)::int AS cnt
      FROM sted_assessment s
      INNER JOIN center_area ca ON ca.center_id = s.center_id
      WHERE s.deleted_at IS NULL
        AND s.assessment_date >= ${from}
        AND s.assessment_date <= ${to}
      GROUP BY ca.area_id
    `;
  }

  /**
   * Mean of each center's latest submitted/verified self-evaluation %, not range-limited
   * (same "latest" rule as the GIS center metrics map).
   */
  private async selfEvalByArea(
    cte: Prisma.Sql,
  ): Promise<Array<{ areaId: string; avgPercent: Numeric; cnt: number }>> {
    return this.prisma.$queryRaw<Array<{ areaId: string; avgPercent: Numeric; cnt: number }>>`
      /* analytics_area_indicators_self_eval */
      ${cte},
      latest AS (
        SELECT DISTINCT ON (a.center_id) a.center_id, a.overall_percent
        FROM compliance_assessment a
        INNER JOIN center_area ca ON ca.center_id = a.center_id
        WHERE a.deleted_at IS NULL
          AND a.assessment_type = 'self_assessment'
          AND a.status IN ('submitted', 'verified')
        ORDER BY a.center_id, a.assessment_date DESC, a.created_at DESC
      )
      SELECT
        ca.area_id AS "areaId",
        AVG(l.overall_percent)::float8 AS "avgPercent",
        COUNT(l.overall_percent)::int AS cnt
      FROM latest l
      INNER JOIN center_area ca ON ca.center_id = l.center_id
      GROUP BY ca.area_id
    `;
  }
}

import { AdministrativeLevel, ChildStatus, UserRole } from '../../common/domain';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { assertDistrictAccess } from '../../common/auth/scope.util';
import { resolveInclusiveDateRange } from '../../common/scope/district-query.scope';
import { PrismaService } from '../../prisma/prisma.service';
import { centerAreaCte } from './center-area.sql';
import { AuthUser } from '../auth/interfaces/jwt-payload.interface';
import {
  CONDITION_MIN_DENOMINATOR,
  buildConditionAreaItems,
  tallyConditionsByArea,
  type AreaChildrenRow,
  type ConditionArea,
  type LatestHeightRow,
  type LatestScreeningRow,
} from './children-conditions.calc';
import {
  ChildrenConditionsQueryDto,
  type ChildrenConditionLevel,
} from './dto/children-conditions-query.dto';
import { ChildrenConditionsResponseDto } from './dto/children-conditions-response.dto';

const DEFAULT_RANGE_DAYS = 89;
const MAX_RANGE_DAYS = 366;
const DAY_MS = 24 * 60 * 60 * 1000;

type Numeric = Prisma.Decimal | number | string | null;
const toNumber = (value: Numeric) => (value == null ? null : Number(value));

/**
 * Children by condition per district or sector, attributed to the area where the
 * child's ECD center is located. Aggregate-only: never returns child-level rows, and
 * withholds affected counts/rates below {@link CONDITION_MIN_DENOMINATOR}.
 */
@Injectable()
export class ChildrenConditionsService {
  constructor(private readonly prisma: PrismaService) {}

  async getChildrenConditions(
    user: AuthUser,
    query: ChildrenConditionsQueryDto,
  ): Promise<ChildrenConditionsResponseDto> {
    const level: ChildrenConditionLevel = query.level ?? 'district';
    const districtId = this.resolveDistrictFilter(user, query);
    if (level === 'sector' && !districtId) {
      throw new BadRequestException('`level=sector` requires a districtId');
    }

    const { from, to } = resolveInclusiveDateRange(query.from, query.to, DEFAULT_RANGE_DAYS);
    if ((to.getTime() - from.getTime()) / DAY_MS > MAX_RANGE_DAYS) {
      throw new BadRequestException(`Date range cannot exceed ${MAX_RANGE_DAYS} days`);
    }

    const cte = centerAreaCte(level, districtId);
    const [listedAreas, children, screenings, heights] = await Promise.all([
      this.loadAreas(level, districtId),
      this.childrenByArea(cte),
      this.latestScreenings(cte, from, to),
      this.latestHeights(cte, from, to),
    ]);
    const areas =
      level === 'sector'
        ? await this.withUnlistedSectors(listedAreas, children, districtId as string)
        : listedAreas;

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      level,
      districtId,
      minDenominator: CONDITION_MIN_DENOMINATOR,
      items: buildConditionAreaItems(areas, children, tallyConditionsByArea(screenings, heights)),
    };
  }

  /** NCDA: optional district; district focal person: pinned. Everyone else (incl. sector) → 403. */
  private resolveDistrictFilter(user: AuthUser, query: ChildrenConditionsQueryDto): string | null {
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
      'Children by condition is available to NCDA and district focal persons only',
    );
  }

  private async loadAreas(
    level: ChildrenConditionLevel,
    districtId: string | null,
  ): Promise<ConditionArea[]> {
    if (level === 'district') {
      const districts = await this.prisma.district.findMany({
        where: districtId ? { id: districtId } : {},
        select: { id: true, name: true, code: true },
      });
      if (districtId && districts.length === 0) throw new NotFoundException('District not found');
      return districts.map((d) => ({
        areaId: d.id,
        areaName: d.name,
        areaCode: d.code,
        districtId: d.id,
        districtName: d.name,
      }));
    }

    const district = await this.prisma.district.findUnique({
      where: { id: districtId as string },
      select: { id: true, name: true },
    });
    if (!district) throw new NotFoundException('District not found');
    const sectors = await this.prisma.administrativeUnit.findMany({
      where: { level: AdministrativeLevel.sector, districtId: district.id },
      select: { id: true, name: true, code: true },
    });
    return sectors.map((s) => ({
      areaId: s.id,
      areaName: s.name,
      areaCode: s.code,
      districtId: district.id,
      districtName: district.name,
    }));
  }

  /**
   * Sectors with children but no `district_id` on the unit are missing from
   * {@link loadAreas}; add them so their children are not silently dropped.
   */
  private async withUnlistedSectors(
    areas: ConditionArea[],
    children: AreaChildrenRow[],
    districtId: string,
  ): Promise<ConditionArea[]> {
    const listed = new Set(areas.map((a) => a.areaId));
    const missing = children.map((r) => r.areaId).filter((id) => !listed.has(id));
    if (missing.length === 0) return areas;
    const [district, units] = await Promise.all([
      this.prisma.district.findUnique({ where: { id: districtId }, select: { name: true } }),
      this.prisma.administrativeUnit.findMany({
        where: { id: { in: missing } },
        select: { id: true, name: true, code: true },
      }),
    ]);
    const districtName = district?.name ?? '';
    return [
      ...areas,
      ...units.map((u) => ({
        areaId: u.id,
        areaName: u.name,
        areaCode: u.code,
        districtId,
        districtName,
      })),
    ];
  }

  private async childrenByArea(cte: Prisma.Sql): Promise<AreaChildrenRow[]> {
    return this.prisma.$queryRaw<AreaChildrenRow[]>`
      /* analytics_children_conditions_children */
      ${cte}
      SELECT
        ca.area_id AS "areaId",
        COUNT(*)::int AS active,
        COUNT(*) FILTER (
          WHERE (ch.special_needs IS NOT NULL AND BTRIM(ch.special_needs) <> '')
             OR (ch.disability_notes IS NOT NULL AND BTRIM(ch.disability_notes) <> '')
        )::int AS "withDisability"
      FROM child ch
      INNER JOIN center_area ca ON ca.center_id = ch.center_id
      WHERE ch.deleted_at IS NULL AND ch.status = ${ChildStatus.active}
      GROUP BY ca.area_id
    `;
  }

  /** One row per active child: latest screening in range. */
  private async latestScreenings(
    cte: Prisma.Sql,
    from: Date,
    to: Date,
  ): Promise<LatestScreeningRow[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        area_id: string;
        child_id: string;
        date_of_birth: Date | null;
        gender: string | null;
        screening_date: Date;
        weight_kg: Numeric;
        muac_cm: Numeric;
      }>
    >`
      /* analytics_children_conditions_latest_screening */
      ${cte}
      SELECT DISTINCT ON (s.child_id)
        ca.area_id, s.child_id, ch.date_of_birth, ch.gender,
        s.screening_date, s.weight_kg, s.muac_cm
      FROM child_nutrition_screening s
      INNER JOIN child ch ON ch.id = s.child_id
      INNER JOIN center_area ca ON ca.center_id = ch.center_id
      WHERE s.deleted_at IS NULL
        AND s.screening_date >= ${from}
        AND s.screening_date <= ${to}
        AND ch.deleted_at IS NULL
        AND ch.status = ${ChildStatus.active}
      ORDER BY s.child_id, s.screening_date DESC, s.created_at DESC
    `;
    return rows.map((r) => ({
      areaId: r.area_id,
      childId: r.child_id,
      dateOfBirth: r.date_of_birth,
      gender: r.gender,
      screeningDate: r.screening_date,
      weightKg: toNumber(r.weight_kg),
      muacCm: toNumber(r.muac_cm),
    }));
  }

  /** One row per active child: latest screening in range that has a height. */
  private async latestHeights(cte: Prisma.Sql, from: Date, to: Date): Promise<LatestHeightRow[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        area_id: string;
        child_id: string;
        date_of_birth: Date | null;
        gender: string | null;
        screening_date: Date;
        height_cm: Numeric;
      }>
    >`
      /* analytics_children_conditions_latest_height */
      ${cte}
      SELECT DISTINCT ON (s.child_id)
        ca.area_id, s.child_id, ch.date_of_birth, ch.gender, s.screening_date, s.height_cm
      FROM child_nutrition_screening s
      INNER JOIN child ch ON ch.id = s.child_id
      INNER JOIN center_area ca ON ca.center_id = ch.center_id
      WHERE s.deleted_at IS NULL
        AND s.height_cm IS NOT NULL
        AND s.screening_date >= ${from}
        AND s.screening_date <= ${to}
        AND ch.deleted_at IS NULL
        AND ch.status = ${ChildStatus.active}
      ORDER BY s.child_id, s.screening_date DESC, s.created_at DESC
    `;
    return rows.map((r) => ({
      areaId: r.area_id,
      childId: r.child_id,
      dateOfBirth: r.date_of_birth,
      gender: r.gender,
      screeningDate: r.screening_date,
      heightCm: toNumber(r.height_cm),
    }));
  }
}

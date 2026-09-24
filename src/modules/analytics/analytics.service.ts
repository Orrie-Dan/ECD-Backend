import {
  AttendanceStatus,
  ChildGender,
  ChildStatus,
  EducationLevel,
  UserAccountStatus,
  UserRole,
} from '../../common/domain';
import {
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import { Prisma, ReferralStatus } from '@prisma/client';
import {
  centerIdWhere as scopeCenterIdWhere,
  childCenterWhere as scopeChildCenterWhere,
  ecdCenterWhere,
  resolveDistrictQueryScope,
  type DistrictQueryScope,
  type ScopeQuery,
} from '../../common/scope/district-query.scope';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../auth/interfaces/jwt-payload.interface';
import { decimalToNumber } from '../nutrition/mappers/nutrition.mapper';
import { aggregateWhoScreenings } from '../nutrition/who/concern';
import { ChildrenDemographicsQueryDto } from './dto/children-demographics-query.dto';
import {
  ChildrenDemographicsResponseDto,
  DemographicSliceDto,
} from './dto/children-demographics-response.dto';
import { DashboardQueryDto } from './dto/dashboard-query.dto';
import { DashboardResponseDto } from './dto/dashboard-response.dto';

type ResolvedAnalyticsScope = DistrictQueryScope;

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async getDashboard(user: AuthUser, query: DashboardQueryDto): Promise<DashboardResponseDto> {
    const { from, to } = resolveDateRange(query.from, query.to);
    const scope = await resolveDistrictQueryScope(this.prisma, user, geoFromQuery(query));

    if (scope.centerIds !== 'all' && scope.centerIds.length === 0) {
      return emptyDashboard(scope, from, to);
    }

    const centersInScope = await this.prisma.ecdCenter.count({
      where: ecdCenterWhere(scope),
    });

    // When scoped to explicit center ids (caregiver / district / sector / center filter)
    const centerIdWhere = scopeCenterIdWhere(scope);
    const childCenterWhere = scopeChildCenterWhere(scope);

    const [
      childTotal,
      childActive,
      childArchived,
      childTransferred,
      attendancePresent,
      attendanceAbsent,
      centersReportingAttendance,
      nutritionRows,
      nutritionRequiresReferral,
      referralsCreated,
      referralsPending,
      referralsCompleted,
      referralsCancelled,
      feedingAgg,
      feedingCentersReporting,
      feedingMilk,
      feedingPorridge,
      feedingBalanced,
    ] = await Promise.all([
      this.prisma.child.count({
        where: { deletedAt: null, ...childCenterWhere },
      }),
      this.prisma.child.count({
        where: {
          deletedAt: null,
          status: ChildStatus.active,
          ...childCenterWhere,
        },
      }),
      this.prisma.child.count({
        where: {
          deletedAt: null,
          status: ChildStatus.archived,
          ...childCenterWhere,
        },
      }),
      this.prisma.child.count({
        where: {
          deletedAt: null,
          status: ChildStatus.transferred,
          ...childCenterWhere,
        },
      }),
      this.prisma.attendanceRecord.count({
        where: {
          deletedAt: null,
          status: AttendanceStatus.present,
          attendanceDate: { gte: from, lte: to },
          ...centerIdWhere,
        },
      }),
      this.prisma.attendanceRecord.count({
        where: {
          deletedAt: null,
          status: AttendanceStatus.absent,
          attendanceDate: { gte: from, lte: to },
          ...centerIdWhere,
        },
      }),
      // National-safe: COUNT(DISTINCT) — never hydrate center id lists
      countDistinctCenterIds(
        this.prisma,
        'attendance_record',
        'attendance_date',
        from,
        to,
        scope.centerIds,
      ),
      this.prisma.childNutritionScreening.findMany({
        where: {
          deletedAt: null,
          screeningDate: { gte: from, lte: to },
          child: { deletedAt: null, ...childCenterWhere },
        },
        select: {
          weightKg: true,
          heightCm: true,
          muacCm: true,
          screeningDate: true,
          child: { select: { dateOfBirth: true, gender: true } },
        },
        take: 10000,
      }),
      this.prisma.childNutritionScreening.count({
        where: {
          deletedAt: null,
          requiresReferral: true,
          screeningDate: { gte: from, lte: to },
          child: { deletedAt: null, ...childCenterWhere },
        },
      }),
      this.prisma.referral.count({
        where: {
          deletedAt: null,
          referralDate: { gte: from, lte: to },
          ...centerIdWhere,
        },
      }),
      this.prisma.referral.count({
        where: {
          deletedAt: null,
          status: ReferralStatus.pending,
          ...centerIdWhere,
        },
      }),
      this.prisma.referral.count({
        where: {
          deletedAt: null,
          status: ReferralStatus.completed,
          referralDate: { gte: from, lte: to },
          ...centerIdWhere,
        },
      }),
      this.prisma.referral.count({
        where: {
          deletedAt: null,
          status: ReferralStatus.cancelled,
          referralDate: { gte: from, lte: to },
          ...centerIdWhere,
        },
      }),
      this.prisma.centerFeedingDay.count({
        where: {
          deletedAt: null,
          recordedDate: { gte: from, lte: to },
          ...centerIdWhere,
        },
      }),
      countDistinctCenterIds(
        this.prisma,
        'center_feeding_day',
        'recorded_date',
        from,
        to,
        scope.centerIds,
      ),
      this.prisma.centerFeedingDay.count({
        where: {
          deletedAt: null,
          milkServed: true,
          recordedDate: { gte: from, lte: to },
          ...centerIdWhere,
        },
      }),
      this.prisma.centerFeedingDay.count({
        where: {
          deletedAt: null,
          porridgeServed: true,
          recordedDate: { gte: from, lte: to },
          ...centerIdWhere,
        },
      }),
      this.prisma.centerFeedingDay.count({
        where: {
          deletedAt: null,
          balancedMealServed: true,
          recordedDate: { gte: from, lte: to },
          ...centerIdWhere,
        },
      }),
    ]);

    const whoAgg = aggregateWhoScreenings(
      nutritionRows.map((row) => ({
        dateOfBirth: row.child.dateOfBirth,
        gender: row.child.gender,
        screeningDate: row.screeningDate,
        weightKg: decimalToNumber(row.weightKg),
        heightCm: decimalToNumber(row.heightCm),
        muacCm: decimalToNumber(row.muacCm),
      })),
    );
    const screenings = whoAgg.screenings;

    const totalAttendance = attendancePresent + attendanceAbsent;
    const rate =
      totalAttendance > 0 ? Math.round((attendancePresent / totalAttendance) * 1000) / 10 : null;

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      districtId: scope.districtId,
      sectorId: scope.sectorId,
      centerId: scope.singleCenterId,
      centersInScope,
      children: {
        total: childTotal,
        active: childActive,
        archived: childArchived,
        transferred: childTransferred,
      },
      attendance: {
        present: attendancePresent,
        absent: attendanceAbsent,
        totalRecords: totalAttendance,
        rate,
        centersReporting: centersReportingAttendance,
      },
      nutrition: {
        screenings,
        // Compat remap from WHO zones — NOT a combined clinical score.
        severe: whoAgg.severe,
        moderate: whoAgg.moderate,
        atRisk: whoAgg.atRisk,
        normal: whoAgg.normal,
        requiresReferral: nutritionRequiresReferral,
      },
      referrals: {
        created: referralsCreated,
        pending: referralsPending,
        completed: referralsCompleted,
        cancelled: referralsCancelled,
      },
      feeding: {
        daysRecorded: feedingAgg,
        daysWithMilk: feedingMilk,
        daysWithPorridge: feedingPorridge,
        daysWithBalancedMeal: feedingBalanced,
        centersReporting: feedingCentersReporting,
      },
    };
  }

  /**
   * Drill-down for the dashboard "total children" KPI:
   * active-child gender/age/disability breakdown, caregiver rollups, and per-district series.
   */
  async getChildrenDemographics(
    user: AuthUser,
    query: ChildrenDemographicsQueryDto,
  ): Promise<ChildrenDemographicsResponseDto> {
    const scope = await this.resolveScope(user, geoFromQuery(query));
    const asOf = startOfUtcDay(new Date());

    if (scope.centerIds !== 'all' && scope.centerIds.length === 0) {
      return emptyChildrenDemographics(scope, asOf);
    }

    const centersInScope = await this.prisma.ecdCenter.count({
      where: ecdCenterWhere(scope),
    });

    if (centersInScope === 0) {
      return emptyChildrenDemographics(scope, asOf);
    }

    const childScopeSql = this.buildChildCenterScopeSql(scope);
    const staffScopeSql = this.buildStaffCenterScopeSql(scope);
    const districtScopeSql = this.buildDistrictScopeSql(scope);

    const [demoRows, staffRows, certifiedRows, byDistrictRows] = await Promise.all([
      this.prisma.$queryRaw<
        Array<{
          ageBand: string;
          gender: string;
          hasDisability: boolean;
          cnt: number;
        }>
      >`
        SELECT
          CASE
            WHEN age_years < 3 THEN 'age_0_2'
            WHEN age_years < 7 THEN 'age_3_6'
            ELSE 'age_above_6'
          END AS "ageBand",
          gender,
          has_disability AS "hasDisability",
          COUNT(*)::int AS cnt
        FROM (
          SELECT
            ch.gender,
            DATE_PART('year', AGE(${asOf}::date, ch.date_of_birth))::int AS age_years,
            (
              (ch.special_needs IS NOT NULL AND BTRIM(ch.special_needs) <> '')
              OR (ch.disability_notes IS NOT NULL AND BTRIM(ch.disability_notes) <> '')
            ) AS has_disability
          FROM child ch
          INNER JOIN ecd_center c ON c.id = ch.center_id AND c.deleted_at IS NULL
          WHERE ch.deleted_at IS NULL
            AND ch.status = ${ChildStatus.active}
            AND ${childScopeSql}
        ) t
        GROUP BY 1, 2, 3
      `,
      this.prisma.$queryRaw<
        Array<{
          role: string;
          gender: string | null;
          educationLevel: string | null;
          cnt: number;
        }>
      >`
        SELECT
          u.role,
          u.gender,
          u.education_level AS "educationLevel",
          COUNT(*)::int AS cnt
        FROM user_account u
        WHERE u.status = ${UserAccountStatus.active}
          AND u.role IN (${Prisma.join([UserRole.caregiver, UserRole.ecd_director])})
          AND ${staffScopeSql}
        GROUP BY u.role, u.gender, u.education_level
      `,
      this.prisma.$queryRaw<Array<{ cnt: number }>>`
        SELECT COUNT(DISTINCT u.id)::int AS cnt
        FROM user_account u
        INNER JOIN staff_training st
          ON st.trainee_user_id = u.id
         AND st.deleted_at IS NULL
         AND st.certificate_received = TRUE
        WHERE u.status = ${UserAccountStatus.active}
          AND u.role = ${UserRole.caregiver}
          AND ${staffScopeSql}
      `,
      this.prisma.$queryRaw<
        Array<{
          districtId: string;
          districtName: string;
          districtCode: string;
          boys: number;
          girls: number;
          total: number;
        }>
      >`
        SELECT
          d.id AS "districtId",
          d.name AS "districtName",
          d.code AS "districtCode",
          COALESCE(SUM(CASE WHEN ch.gender = ${ChildGender.male} THEN 1 ELSE 0 END), 0)::int AS boys,
          COALESCE(SUM(CASE WHEN ch.gender = ${ChildGender.female} THEN 1 ELSE 0 END), 0)::int AS girls,
          COUNT(ch.id)::int AS total
        FROM district d
        LEFT JOIN ecd_center c
          ON c.district_id = d.id
         AND c.deleted_at IS NULL
         AND ${
           scope.singleCenterId
             ? Prisma.sql`c.id = ${scope.singleCenterId}`
             : scope.centerIds !== 'all'
               ? scope.centerIds.length === 0
                 ? Prisma.sql`FALSE`
                 : Prisma.sql`c.id IN (${Prisma.join(scope.centerIds)})`
               : scope.villageId
                 ? Prisma.sql`c.village_id = ${scope.villageId}`
                 : Prisma.sql`TRUE`
         }
        LEFT JOIN child ch
          ON ch.center_id = c.id
         AND ch.deleted_at IS NULL
         AND ch.status = ${ChildStatus.active}
        WHERE ${districtScopeSql}
        GROUP BY d.id, d.name, d.code
        ORDER BY d.name ASC
      `,
    ]);

    const emptySlice = (): DemographicSliceDto => ({
      boys: 0,
      boysWithDisability: 0,
      girls: 0,
      girlsWithDisability: 0,
      withDisability: 0,
      total: 0,
    });

    const byAgeBand = {
      age_0_2: emptySlice(),
      age_3_6: emptySlice(),
      age_above_6: emptySlice(),
    };

    let boys = 0;
    let girls = 0;
    let withDisability = 0;
    let total = 0;

    for (const row of demoRows) {
      const bandKey =
        row.ageBand === 'age_0_2' || row.ageBand === 'age_3_6' || row.ageBand === 'age_above_6'
          ? row.ageBand
          : null;
      if (!bandKey) continue;

      const slice = byAgeBand[bandKey];
      const cnt = row.cnt;
      const disabled = row.hasDisability;

      if (row.gender === ChildGender.male) {
        slice.boys += cnt;
        boys += cnt;
        if (disabled) {
          slice.boysWithDisability += cnt;
          slice.withDisability += cnt;
          withDisability += cnt;
        }
      } else if (row.gender === ChildGender.female) {
        slice.girls += cnt;
        girls += cnt;
        if (disabled) {
          slice.girlsWithDisability += cnt;
          slice.withDisability += cnt;
          withDisability += cnt;
        }
      } else if (disabled) {
        slice.withDisability += cnt;
        withDisability += cnt;
      }

      slice.total += cnt;
      total += cnt;
    }

    const caregivers = {
      total: 0,
      male: 0,
      female: 0,
      unknownGender: 0,
      education: {
        withTrainingCertificate: certifiedRows[0]?.cnt ?? 0,
        diploma: 0,
        degree: 0,
      },
    };
    const supportingStaff = {
      total: 0,
      male: 0,
      female: 0,
      unknownGender: 0,
    };

    for (const row of staffRows) {
      const target = row.role === UserRole.caregiver ? caregivers : supportingStaff;
      target.total += row.cnt;
      if (row.gender === ChildGender.male) {
        target.male += row.cnt;
      } else if (row.gender === ChildGender.female) {
        target.female += row.cnt;
      } else {
        target.unknownGender += row.cnt;
      }

      if (row.role === UserRole.caregiver) {
        if (row.educationLevel === EducationLevel.diploma) {
          caregivers.education.diploma += row.cnt;
        } else if (
          row.educationLevel === EducationLevel.bachelor ||
          row.educationLevel === EducationLevel.postgraduate
        ) {
          caregivers.education.degree += row.cnt;
        }
      }
    }

    const childrenPerCaregiver =
      caregivers.total > 0 ? Math.round((total / caregivers.total) * 10) / 10 : null;

    return {
      asOf: asOf.toISOString(),
      districtId: scope.districtId,
      centerId: scope.singleCenterId,
      centersInScope,
      children: {
        total,
        boys,
        girls,
        withDisability,
        byAgeBand,
      },
      caregivers,
      supportingStaff,
      childrenPerCaregiver,
      byDistrict: byDistrictRows,
    };
  }

  private buildChildCenterScopeSql(scope: ResolvedAnalyticsScope): Prisma.Sql {
    if (scope.singleCenterId) {
      return Prisma.sql`ch.center_id = ${scope.singleCenterId}`;
    }
    if (scope.centerIds !== 'all') {
      if (scope.centerIds.length === 0) return Prisma.sql`FALSE`;
      return Prisma.sql`ch.center_id IN (${Prisma.join(scope.centerIds)})`;
    }
    if (scope.villageId) {
      return Prisma.sql`c.village_id = ${scope.villageId}`;
    }
    if (scope.districtId) {
      return Prisma.sql`c.district_id = ${scope.districtId}`;
    }
    if (scope.provinceId) {
      return Prisma.sql`c.district_id IN (
        SELECT id FROM district WHERE province_id = ${scope.provinceId}
      )`;
    }
    return Prisma.sql`TRUE`;
  }

  private buildStaffCenterScopeSql(scope: ResolvedAnalyticsScope): Prisma.Sql {
    if (scope.singleCenterId) {
      return Prisma.sql`u.center_id = ${scope.singleCenterId}`;
    }
    if (scope.centerIds !== 'all') {
      if (scope.centerIds.length === 0) return Prisma.sql`FALSE`;
      return Prisma.sql`u.center_id IN (${Prisma.join(scope.centerIds)})`;
    }
    if (scope.villageId) {
      return Prisma.sql`u.center_id IN (
        SELECT id FROM ecd_center WHERE deleted_at IS NULL AND village_id = ${scope.villageId}
      )`;
    }
    if (scope.districtId) {
      return Prisma.sql`u.center_id IN (
        SELECT id FROM ecd_center WHERE deleted_at IS NULL AND district_id = ${scope.districtId}
      )`;
    }
    if (scope.provinceId) {
      return Prisma.sql`u.center_id IN (
        SELECT c.id FROM ecd_center c
        INNER JOIN district d ON d.id = c.district_id
        WHERE c.deleted_at IS NULL AND d.province_id = ${scope.provinceId}
      )`;
    }
    return Prisma.sql`u.center_id IS NOT NULL`;
  }

  private buildDistrictScopeSql(scope: ResolvedAnalyticsScope): Prisma.Sql {
    if (scope.districtId) {
      return Prisma.sql`d.id = ${scope.districtId}`;
    }
    if (scope.provinceId) {
      return Prisma.sql`d.province_id = ${scope.provinceId}`;
    }
    return Prisma.sql`TRUE`;
  }

  private async resolveScope(
    user: AuthUser,
    query: ScopeQuery,
  ): Promise<ResolvedAnalyticsScope> {
    return resolveDistrictQueryScope(this.prisma, user, query);
  }
}

/**
 * Bounded scalar: distinct reporting centers without hydrating id lists.
 * Tables/columns are compile-time constants only (never user input).
 */
async function countDistinctCenterIds(
  prisma: PrismaService,
  table: 'attendance_record' | 'center_feeding_day',
  dateColumn: 'attendance_date' | 'recorded_date',
  from: Date,
  to: Date,
  centerIds: string[] | 'all',
): Promise<number> {
  if (centerIds !== 'all' && centerIds.length === 0) return 0;

  const conditions: Prisma.Sql[] = [
    Prisma.sql`deleted_at IS NULL`,
    Prisma.sql`${Prisma.raw(dateColumn)} >= ${from}`,
    Prisma.sql`${Prisma.raw(dateColumn)} <= ${to}`,
  ];

  if (centerIds !== 'all') {
    conditions.push(Prisma.sql`center_id IN (${Prisma.join(centerIds)})`);
  }

  const rows = await prisma.$queryRaw<Array<{ cnt: number }>>`
    SELECT COUNT(DISTINCT center_id)::int AS cnt
    FROM ${Prisma.raw(table)}
    WHERE ${Prisma.join(conditions, ' AND ')}
  `;

  return rows[0]?.cnt ?? 0;
}

function geoFromQuery(query: {
  provinceId?: string;
  districtId?: string;
  sectorId?: string;
  cellId?: string;
  villageId?: string;
  centerId?: string;
}): ScopeQuery {
  return {
    provinceId: query.provinceId,
    districtId: query.districtId,
    sectorId: query.sectorId,
    cellId: query.cellId,
    villageId: query.villageId,
    centerId: query.centerId,
  };
}

function resolveDateRange(from?: Date, to?: Date): { from: Date; to: Date } {
  const end = to ? startOfUtcDay(to) : startOfUtcDay(new Date());
  const start = from
    ? startOfUtcDay(from)
    : new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate() - 29));

  if (start.getTime() > end.getTime()) {
    throw new BadRequestException('`from` must be on or before `to`');
  }

  // Inclusive end-of-day for date comparisons stored as @db.Date
  return { from: start, to: end };
}

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function emptyDashboard(
  scope: {
    districtId: string | null;
    sectorId: string | null;
    singleCenterId: string | null;
  },
  from: Date,
  to: Date,
): DashboardResponseDto {
  return {
    from: from.toISOString(),
    to: to.toISOString(),
    districtId: scope.districtId,
    sectorId: scope.sectorId,
    centerId: scope.singleCenterId,
    centersInScope: 0,
    children: { total: 0, active: 0, archived: 0, transferred: 0 },
    attendance: {
      present: 0,
      absent: 0,
      totalRecords: 0,
      rate: null,
      centersReporting: 0,
    },
    nutrition: {
      screenings: 0,
      severe: 0,
      moderate: 0,
      atRisk: 0,
      normal: 0,
      requiresReferral: 0,
    },
    referrals: { created: 0, pending: 0, completed: 0, cancelled: 0 },
    feeding: {
      daysRecorded: 0,
      daysWithMilk: 0,
      daysWithPorridge: 0,
      daysWithBalancedMeal: 0,
      centersReporting: 0,
    },
  };
}

function emptyChildrenDemographics(
  scope: {
    districtId: string | null;
    singleCenterId: string | null;
  },
  asOf: Date,
): ChildrenDemographicsResponseDto {
  const emptySlice = (): DemographicSliceDto => ({
    boys: 0,
    boysWithDisability: 0,
    girls: 0,
    girlsWithDisability: 0,
    withDisability: 0,
    total: 0,
  });

  return {
    asOf: asOf.toISOString(),
    districtId: scope.districtId,
    centerId: scope.singleCenterId,
    centersInScope: 0,
    children: {
      total: 0,
      boys: 0,
      girls: 0,
      withDisability: 0,
      byAgeBand: {
        age_0_2: emptySlice(),
        age_3_6: emptySlice(),
        age_above_6: emptySlice(),
      },
    },
    caregivers: {
      total: 0,
      male: 0,
      female: 0,
      unknownGender: 0,
      education: {
        withTrainingCertificate: 0,
        diploma: 0,
        degree: 0,
      },
    },
    supportingStaff: {
      total: 0,
      male: 0,
      female: 0,
      unknownGender: 0,
    },
    childrenPerCaregiver: null,
    byDistrict: [],
  };
}

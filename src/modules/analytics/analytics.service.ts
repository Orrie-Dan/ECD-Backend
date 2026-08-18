import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AttendanceStatus,
  ChildStatus,
  NutritionStatus,
  Prisma,
  ReferralStatus,
  UserRole,
} from '@prisma/client';
import {
  assertCenterAccess,
  assertDistrictAccess,
  isCenterStaffRole,
} from '../../common/auth/scope.util';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../auth/interfaces/jwt-payload.interface';
import { DashboardQueryDto } from './dto/dashboard-query.dto';
import { DashboardResponseDto } from './dto/dashboard-response.dto';

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async getDashboard(
    user: AuthUser,
    query: DashboardQueryDto,
  ): Promise<DashboardResponseDto> {
    const { from, to } = resolveDateRange(query.from, query.to);
    const scope = await this.resolveScope(user, query);

    if (scope.centerIds !== 'all' && scope.centerIds.length === 0) {
      return emptyDashboard(scope, from, to);
    }

    const centerFilter =
      scope.centerIds === 'all'
        ? undefined
        : { in: scope.centerIds };

    const centersInScope = await this.prisma.ecdCenter.count({
      where: {
        deletedAt: null,
        ...(centerFilter ? { id: centerFilter } : {}),
        ...(scope.districtId && scope.centerIds === 'all'
          ? { districtId: scope.districtId }
          : {}),
      },
    });

    // When scoped to explicit center ids (caregiver / district / center filter)
    const centerIdWhere = centerFilter ? { centerId: centerFilter } : {};
    const childCenterWhere = centerFilter
      ? { centerId: centerFilter }
      : scope.districtId
        ? { center: { districtId: scope.districtId, deletedAt: null } }
        : {};

    const [
      childTotal,
      childActive,
      childArchived,
      childTransferred,
      attendancePresent,
      attendanceAbsent,
      centersReportingAttendance,
      nutritionGrouped,
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
      this.prisma.childNutritionScreening.groupBy({
        by: ['nutritionStatus'],
        where: {
          deletedAt: null,
          screeningDate: { gte: from, lte: to },
          child: { deletedAt: null, ...childCenterWhere },
        },
        _count: { _all: true },
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

    const nutritionCounts: Record<string, number> = {
      [NutritionStatus.normal]: 0,
      [NutritionStatus.at_risk]: 0,
      [NutritionStatus.moderate]: 0,
      [NutritionStatus.severe]: 0,
    };
    let screenings = 0;
    for (const row of nutritionGrouped) {
      nutritionCounts[row.nutritionStatus] = row._count._all;
      screenings += row._count._all;
    }

    const totalAttendance = attendancePresent + attendanceAbsent;
    const rate =
      totalAttendance > 0
        ? Math.round((attendancePresent / totalAttendance) * 1000) / 10
        : null;

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      districtId: scope.districtId,
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
        severe: nutritionCounts[NutritionStatus.severe],
        moderate: nutritionCounts[NutritionStatus.moderate],
        atRisk: nutritionCounts[NutritionStatus.at_risk],
        normal: nutritionCounts[NutritionStatus.normal],
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

  private async resolveScope(
    user: AuthUser,
    query: DashboardQueryDto,
  ): Promise<{
    centerIds: string[] | 'all';
    districtId: string | null;
    singleCenterId: string | null;
  }> {
    if (query.centerId && query.districtId) {
      // Both allowed if center belongs to district — validated below
    }

    if (isCenterStaffRole(user.role)) {
      if (!user.centerId) {
        throw new ForbiddenException('Center scope is required for this role');
      }
      if (query.centerId && query.centerId !== user.centerId) {
        throw new ForbiddenException('Cannot query another center');
      }
      if (query.districtId) {
        throw new ForbiddenException('Center-scoped roles cannot filter by district');
      }
      return {
        centerIds: [user.centerId],
        districtId: user.districtId,
        singleCenterId: user.centerId,
      };
    }

    if (user.role === UserRole.district_focal_person) {
      if (!user.districtId) {
        throw new ForbiddenException('District scope is required');
      }
      if (query.districtId && query.districtId !== user.districtId) {
        assertDistrictAccess(user, query.districtId);
      }

      if (query.centerId) {
        const center = await this.prisma.ecdCenter.findFirst({
          where: { id: query.centerId, deletedAt: null },
          select: { id: true, districtId: true },
        });
        if (!center) throw new NotFoundException('Center not found');
        assertCenterAccess(user, center.id, center.districtId);
        return {
          centerIds: [center.id],
          districtId: user.districtId,
          singleCenterId: center.id,
        };
      }

      const centers = await this.prisma.ecdCenter.findMany({
        where: { districtId: user.districtId, deletedAt: null },
        select: { id: true },
      });
      return {
        centerIds: centers.map((c) => c.id),
        districtId: user.districtId,
        singleCenterId: null,
      };
    }

    // ncda_admin
    if (query.centerId) {
      const center = await this.prisma.ecdCenter.findFirst({
        where: { id: query.centerId, deletedAt: null },
        select: { id: true, districtId: true },
      });
      if (!center) throw new NotFoundException('Center not found');
      if (query.districtId && query.districtId !== center.districtId) {
        throw new BadRequestException(
          'centerId does not belong to the given districtId',
        );
      }
      return {
        centerIds: [center.id],
        districtId: center.districtId,
        singleCenterId: center.id,
      };
    }

    if (query.districtId) {
      assertDistrictAccess(user, query.districtId);
      const centers = await this.prisma.ecdCenter.findMany({
        where: { districtId: query.districtId, deletedAt: null },
        select: { id: true },
      });
      return {
        centerIds: centers.map((c) => c.id),
        districtId: query.districtId,
        singleCenterId: null,
      };
    }

    return {
      centerIds: 'all',
      districtId: null,
      singleCenterId: null,
    };
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

function resolveDateRange(
  from?: Date,
  to?: Date,
): { from: Date; to: Date } {
  const end = to ? startOfUtcDay(to) : startOfUtcDay(new Date());
  const start = from
    ? startOfUtcDay(from)
    : new Date(
        Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate() - 29),
      );

  if (start.getTime() > end.getTime()) {
    throw new BadRequestException('`from` must be on or before `to`');
  }

  // Inclusive end-of-day for date comparisons stored as @db.Date
  return { from: start, to: end };
}

function startOfUtcDay(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
}

function emptyDashboard(
  scope: {
    districtId: string | null;
    singleCenterId: string | null;
  },
  from: Date,
  to: Date,
): DashboardResponseDto {
  return {
    from: from.toISOString(),
    to: to.toISOString(),
    districtId: scope.districtId,
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

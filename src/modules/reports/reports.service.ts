import { Injectable } from '@nestjs/common';
import {
  AttendanceStatus,
  ChildStatus,
  NutritionStatus,
  ReferralStatus,
  TransferStatus,
} from '@prisma/client';
import {
  centerIdWhere,
  childCenterWhere,
  paginateParams,
  resolveDistrictQueryScope,
  resolveInclusiveDateRange,
} from '../../common/scope/district-query.scope';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../auth/interfaces/jwt-payload.interface';
import { MonitoringQueryDto } from '../monitoring/dto/monitoring-query.dto';

/**
 * Dropout interpretation (no dedicated dropout status in schema):
 * - Primary: children with status=archived whose archivedAt falls in range
 * - Secondary metric: status=transferred with transferred lifecycle in range
 *   (via ChildTransfer accepted in range) — reported separately, not as dropouts
 */
@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async enrollment(user: AuthUser, query: MonitoringQueryDto) {
    const scope = await resolveDistrictQueryScope(this.prisma, user, query);
    const { from, to } = resolveInclusiveDateRange(query.from, query.to);
    const childWhere = childCenterWhere(scope);

    if (scope.centerIds !== 'all' && scope.centerIds.length === 0) {
      return {
        from: from.toISOString(),
        to: to.toISOString(),
        districtId: scope.districtId,
        interpretation: null,
        summary: {
          totalEnrolled: 0,
          active: 0,
          archived: 0,
          transferred: 0,
          newRegistrations: 0,
        },
        trend: [],
      };
    }

    const [total, active, archived, transferred, newRegs] = await Promise.all([
      this.prisma.child.count({
        where: { deletedAt: null, ...childWhere },
      }),
      this.prisma.child.count({
        where: {
          deletedAt: null,
          status: ChildStatus.active,
          ...childWhere,
        },
      }),
      this.prisma.child.count({
        where: {
          deletedAt: null,
          status: ChildStatus.archived,
          ...childWhere,
        },
      }),
      this.prisma.child.count({
        where: {
          deletedAt: null,
          status: ChildStatus.transferred,
          ...childWhere,
        },
      }),
      this.prisma.child.count({
        where: {
          deletedAt: null,
          registeredAt: { gte: from, lte: endOfUtcDay(to) },
          ...childWhere,
        },
      }),
    ]);

    const registrations = await this.prisma.child.findMany({
      where: {
        deletedAt: null,
        registeredAt: { gte: from, lte: endOfUtcDay(to) },
        ...childWhere,
      },
      select: { registeredAt: true },
      take: 10000,
    });

    const trendMap = new Map<string, number>();
    for (const r of registrations) {
      const key = r.registeredAt.toISOString().slice(0, 10);
      trendMap.set(key, (trendMap.get(key) ?? 0) + 1);
    }
    const trend = [...trendMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, count]) => ({ date, newRegistrations: count }));

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      districtId: scope.districtId,
      centerId: scope.singleCenterId,
      summary: {
        totalEnrolled: total,
        active,
        archived,
        transferred,
        newRegistrations: newRegs,
      },
      trend,
    };
  }

  async dropouts(user: AuthUser, query: MonitoringQueryDto) {
    const scope = await resolveDistrictQueryScope(this.prisma, user, query);
    const { from, to } = resolveInclusiveDateRange(query.from, query.to);
    const { page, pageSize, skip } = paginateParams(query.page, query.pageSize);
    const childWhere = childCenterWhere(scope);

    /**
     * Lifecycle mapping (documented for clients):
     * - dropout ≈ ChildStatus.archived with archivedAt in range
     * - transfers are NOT dropouts; listed separately as transfersOut
     */
    const interpretation = {
      dropoutDefinition:
        'Children with status=archived and archivedAt within the date range',
      excluded:
        'Transferred children (status=transferred) are reported as transfersOut, not dropouts',
      note: 'No dedicated dropout enum exists; archived is the existing lifecycle terminal used for leaving the program',
    };

    if (scope.centerIds !== 'all' && scope.centerIds.length === 0) {
      return {
        from: from.toISOString(),
        to: to.toISOString(),
        interpretation,
        summary: { dropouts: 0, transfersOut: 0 },
        items: [],
        total: 0,
        page,
        pageSize,
        totalPages: 1,
      };
    }

    const [dropouts, transfersOut, rows] = await Promise.all([
      this.prisma.child.count({
        where: {
          deletedAt: null,
          status: ChildStatus.archived,
          archivedAt: { gte: from, lte: endOfUtcDay(to) },
          ...childWhere,
        },
      }),
      this.prisma.childTransfer.count({
        where: {
          deletedAt: null,
          status: TransferStatus.accepted,
          acceptedAt: { gte: from, lte: endOfUtcDay(to) },
          ...(scope.centerIds === 'all'
            ? {}
            : { fromCenterId: { in: scope.centerIds } }),
        },
      }),
      this.prisma.child.findMany({
        where: {
          deletedAt: null,
          status: ChildStatus.archived,
          archivedAt: { gte: from, lte: endOfUtcDay(to) },
          ...childWhere,
        },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          centerId: true,
          archivedAt: true,
          archiveReason: true,
          center: { select: { name: true } },
        },
        orderBy: { archivedAt: 'desc' },
        skip,
        take: pageSize,
      }),
    ]);

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      districtId: scope.districtId,
      interpretation,
      summary: { dropouts, transfersOut },
      items: rows.map((r) => ({
        childId: r.id,
        childName: `${r.firstName} ${r.lastName}`.trim(),
        centerId: r.centerId,
        centerName: r.center.name,
        archivedAt: r.archivedAt?.toISOString() ?? null,
        archiveReason: r.archiveReason,
      })),
      total: dropouts,
      page,
      pageSize,
      totalPages: Math.ceil(dropouts / pageSize) || 1,
    };
  }

  async centers(user: AuthUser, query: MonitoringQueryDto) {
    const scope = await resolveDistrictQueryScope(this.prisma, user, query);
    const { from, to } = resolveInclusiveDateRange(query.from, query.to);
    const { page, pageSize, skip } = paginateParams(query.page, query.pageSize);

    const centers = await this.prisma.ecdCenter.findMany({
      where: {
        deletedAt: null,
        ...(scope.centerIds === 'all'
          ? scope.districtId
            ? { districtId: scope.districtId }
            : {}
          : { id: { in: scope.centerIds } }),
      },
      select: { id: true, name: true, code: true, status: true },
      orderBy: { name: 'asc' },
    });

    const items = await Promise.all(
      centers.map(async (c) => {
        const [
          enrolled,
          present,
          absent,
          severe,
          feedingDays,
          pendingRefs,
          stedCount,
        ] = await Promise.all([
          this.prisma.child.count({
            where: {
              deletedAt: null,
              status: ChildStatus.active,
              centerId: c.id,
            },
          }),
          this.prisma.attendanceRecord.count({
            where: {
              deletedAt: null,
              centerId: c.id,
              status: AttendanceStatus.present,
              attendanceDate: { gte: from, lte: to },
            },
          }),
          this.prisma.attendanceRecord.count({
            where: {
              deletedAt: null,
              centerId: c.id,
              status: AttendanceStatus.absent,
              attendanceDate: { gte: from, lte: to },
            },
          }),
          this.prisma.childNutritionScreening.count({
            where: {
              deletedAt: null,
              nutritionStatus: NutritionStatus.severe,
              screeningDate: { gte: from, lte: to },
              child: { centerId: c.id, deletedAt: null },
            },
          }),
          this.prisma.centerFeedingDay.count({
            where: {
              deletedAt: null,
              centerId: c.id,
              recordedDate: { gte: from, lte: to },
            },
          }),
          this.prisma.referral.count({
            where: {
              deletedAt: null,
              centerId: c.id,
              status: ReferralStatus.pending,
            },
          }),
          this.prisma.stedAssessment.count({
            where: {
              deletedAt: null,
              centerId: c.id,
              assessmentDate: { gte: from, lte: to },
            },
          }),
        ]);
        const attTotal = present + absent;
        return {
          centerId: c.id,
          centerCode: c.code,
          centerName: c.name,
          status: c.status,
          enrolledChildren: enrolled,
          attendance: {
            present,
            absent,
            rate:
              attTotal > 0
                ? Math.round((present / attTotal) * 1000) / 10
                : null,
          },
          nutrition: { severeScreenings: severe },
          feeding: { daysRecorded: feedingDays },
          referrals: { pending: pendingRefs },
          sted: { assessmentsCompleted: stedCount },
        };
      }),
    );

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      districtId: scope.districtId,
      items: items.slice(skip, skip + pageSize),
      total: items.length,
      page,
      pageSize,
      totalPages: Math.ceil(items.length / pageSize) || 1,
    };
  }

  async district(user: AuthUser, query: MonitoringQueryDto) {
    const scope = await resolveDistrictQueryScope(this.prisma, user, query);
    const { from, to } = resolveInclusiveDateRange(query.from, query.to);
    const childWhere = childCenterWhere(scope);
    const cWhere = centerIdWhere(scope);

    const centersInScope =
      scope.centerIds === 'all'
        ? await this.prisma.ecdCenter.count({
            where: {
              deletedAt: null,
              ...(scope.districtId ? { districtId: scope.districtId } : {}),
            },
          })
        : scope.centerIds.length;

    const [
      activeChildren,
      present,
      absent,
      screenings,
      severe,
      pendingRefs,
      feedingDays,
      stedCount,
      newRegs,
      dropouts,
    ] = await Promise.all([
      this.prisma.child.count({
        where: {
          deletedAt: null,
          status: ChildStatus.active,
          ...childWhere,
        },
      }),
      this.prisma.attendanceRecord.count({
        where: {
          deletedAt: null,
          status: AttendanceStatus.present,
          attendanceDate: { gte: from, lte: to },
          ...cWhere,
        },
      }),
      this.prisma.attendanceRecord.count({
        where: {
          deletedAt: null,
          status: AttendanceStatus.absent,
          attendanceDate: { gte: from, lte: to },
          ...cWhere,
        },
      }),
      this.prisma.childNutritionScreening.count({
        where: {
          deletedAt: null,
          screeningDate: { gte: from, lte: to },
          child: { deletedAt: null, ...childWhere },
        },
      }),
      this.prisma.childNutritionScreening.count({
        where: {
          deletedAt: null,
          nutritionStatus: NutritionStatus.severe,
          screeningDate: { gte: from, lte: to },
          child: { deletedAt: null, ...childWhere },
        },
      }),
      this.prisma.referral.count({
        where: {
          deletedAt: null,
          status: ReferralStatus.pending,
          ...cWhere,
        },
      }),
      this.prisma.centerFeedingDay.count({
        where: {
          deletedAt: null,
          recordedDate: { gte: from, lte: to },
          ...cWhere,
        },
      }),
      this.prisma.stedAssessment.count({
        where: {
          deletedAt: null,
          assessmentDate: { gte: from, lte: to },
          ...cWhere,
        },
      }),
      this.prisma.child.count({
        where: {
          deletedAt: null,
          registeredAt: { gte: from, lte: endOfUtcDay(to) },
          ...childWhere,
        },
      }),
      this.prisma.child.count({
        where: {
          deletedAt: null,
          status: ChildStatus.archived,
          archivedAt: { gte: from, lte: endOfUtcDay(to) },
          ...childWhere,
        },
      }),
    ]);

    const attTotal = present + absent;

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      districtId: scope.districtId,
      kpis: {
        centersInScope,
        activeChildren,
        newRegistrations: newRegs,
        dropouts,
        attendanceRate:
          attTotal > 0
            ? Math.round((present / attTotal) * 1000) / 10
            : null,
        nutritionScreenings: screenings,
        severeNutrition: severe,
        pendingReferrals: pendingRefs,
        feedingDaysRecorded: feedingDays,
        stedAssessments: stedCount,
      },
    };
  }
}

function endOfUtcDay(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999),
  );
}

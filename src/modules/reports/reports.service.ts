import { Injectable } from '@nestjs/common';
import {
  AttendanceStatus,
  ChildStatus,
  NutritionStatus,
  Prisma,
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
      dropoutDefinition: 'Children with status=archived and archivedAt within the date range',
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
          ...(scope.centerIds === 'all' ? {} : { fromCenterId: { in: scope.centerIds } }),
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
    const cWhere = centerIdWhere(scope);
    const childWhere = childCenterWhere(scope);

    const [
      centers,
      enrolledByCenter,
      attByCenter,
      severeByChildCenter,
      feedingByCenter,
      pendingByCenter,
      stedByCenter,
    ] = await Promise.all([
      this.prisma.ecdCenter.findMany({
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
      }),
      this.prisma.child.groupBy({
        by: ['centerId'],
        where: {
          deletedAt: null,
          status: ChildStatus.active,
          ...childWhere,
        },
        _count: { _all: true },
      }),
      this.prisma.attendanceRecord.groupBy({
        by: ['centerId', 'status'],
        where: {
          deletedAt: null,
          attendanceDate: { gte: from, lte: to },
          ...cWhere,
        },
        _count: { _all: true },
      }),
      this.nutritionSevereByCenter(scope, from, to),
      this.prisma.centerFeedingDay.groupBy({
        by: ['centerId'],
        where: {
          deletedAt: null,
          recordedDate: { gte: from, lte: to },
          ...cWhere,
        },
        _count: { _all: true },
      }),
      this.prisma.referral.groupBy({
        by: ['centerId'],
        where: {
          deletedAt: null,
          status: ReferralStatus.pending,
          ...cWhere,
        },
        _count: { _all: true },
      }),
      this.prisma.stedAssessment.groupBy({
        by: ['centerId'],
        where: {
          deletedAt: null,
          assessmentDate: { gte: from, lte: to },
          ...cWhere,
        },
        _count: { _all: true },
      }),
    ]);

    const enrolledMap = new Map(enrolledByCenter.map((r) => [r.centerId, r._count._all]));
    const presentMap = new Map<string, number>();
    const absentMap = new Map<string, number>();
    for (const row of attByCenter) {
      if (row.status === AttendanceStatus.present) {
        presentMap.set(row.centerId, row._count._all);
      } else if (row.status === AttendanceStatus.absent) {
        absentMap.set(row.centerId, row._count._all);
      }
    }
    const severeMap = new Map(severeByChildCenter.map((r) => [r.centerId, r.cnt]));
    const feedingMap = new Map(feedingByCenter.map((r) => [r.centerId, r._count._all]));
    const pendingMap = new Map(pendingByCenter.map((r) => [r.centerId, r._count._all]));
    const stedMap = new Map(stedByCenter.map((r) => [r.centerId, r._count._all]));

    const items = centers.map((c) => {
      const present = presentMap.get(c.id) ?? 0;
      const absent = absentMap.get(c.id) ?? 0;
      const attTotal = present + absent;
      return {
        centerId: c.id,
        centerCode: c.code,
        centerName: c.name,
        status: c.status,
        enrolledChildren: enrolledMap.get(c.id) ?? 0,
        attendance: {
          present,
          absent,
          rate: attTotal > 0 ? Math.round((present / attTotal) * 1000) / 10 : null,
        },
        nutrition: { severeScreenings: severeMap.get(c.id) ?? 0 },
        feeding: { daysRecorded: feedingMap.get(c.id) ?? 0 },
        referrals: { pending: pendingMap.get(c.id) ?? 0 },
        sted: { assessmentsCompleted: stedMap.get(c.id) ?? 0 },
      };
    });

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
        attendanceRate: attTotal > 0 ? Math.round((present / attTotal) * 1000) / 10 : null,
        nutritionScreenings: screenings,
        severeNutrition: severe,
        pendingReferrals: pendingRefs,
        feedingDaysRecorded: feedingDays,
        stedAssessments: stedCount,
      },
    };
  }

  private async nutritionSevereByCenter(
    scope: { centerIds: string[] | 'all'; districtId: string | null },
    from: Date,
    to: Date,
  ): Promise<Array<{ centerId: string; cnt: number }>> {
    const conditions: Prisma.Sql[] = [
      Prisma.sql`s.deleted_at IS NULL`,
      Prisma.sql`ch.deleted_at IS NULL`,
      Prisma.sql`s.nutrition_status = CAST(${'severe'} AS nutrition_status)`,
      Prisma.sql`s.screening_date >= ${from}`,
      Prisma.sql`s.screening_date <= ${to}`,
    ];

    if (scope.centerIds !== 'all') {
      if (scope.centerIds.length === 0) return [];
      conditions.push(Prisma.sql`ch.center_id IN (${Prisma.join(scope.centerIds)})`);
    } else if (scope.districtId) {
      conditions.push(
        Prisma.sql`ch.center_id IN (
          SELECT id FROM ecd_center
          WHERE district_id = ${scope.districtId} AND deleted_at IS NULL
        )`,
      );
    }

    return this.prisma.$queryRaw`
      SELECT ch.center_id AS "centerId", COUNT(*)::int AS cnt
      FROM child_nutrition_screening s
      INNER JOIN child ch ON ch.id = s.child_id
      WHERE ${Prisma.join(conditions, ' AND ')}
      GROUP BY ch.center_id
    `;
  }
}

function endOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));
}

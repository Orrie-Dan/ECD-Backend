import { Injectable } from '@nestjs/common';
import {
  AttendanceStatus,
  ChildStatus,
  NutritionStatus,
  Prisma,
  ReferralStatus,
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
import { MonitoringQueryDto } from './dto/monitoring-query.dto';

const OVERDUE_SCREENING_DAYS = 30;
const STALE_REFERRAL_DAYS = 7;

@Injectable()
export class MonitoringService {
  constructor(private readonly prisma: PrismaService) {}

  async attendance(user: AuthUser, query: MonitoringQueryDto) {
    const scope = await resolveDistrictQueryScope(this.prisma, user, query);
    const { from, to } = resolveInclusiveDateRange(query.from, query.to);
    const { page, pageSize, skip } = paginateParams(query.page, query.pageSize);

    if (scope.centerIds !== 'all' && scope.centerIds.length === 0) {
      return emptyAttendance(from, to, scope, page, pageSize);
    }

    const cWhere = centerIdWhere(scope);
    const childWhere = childCenterWhere(scope);

    const [enrolled, present, absent, centers, attByCenter, enrolledByCenter] = await Promise.all([
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
      this.loadCenters(scope),
      this.prisma.attendanceRecord.groupBy({
        by: ['centerId', 'status'],
        where: {
          deletedAt: null,
          attendanceDate: { gte: from, lte: to },
          ...cWhere,
        },
        _count: { _all: true },
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
    ]);

    const totalRecords = present + absent;
    const rate = totalRecords > 0 ? Math.round((present / totalRecords) * 1000) / 10 : null;

    const trend = await this.attendanceTrend(scope, from, to);

    const presentByCenter = new Map<string, number>();
    const absentByCenter = new Map<string, number>();
    for (const row of attByCenter) {
      if (row.status === AttendanceStatus.present) {
        presentByCenter.set(row.centerId, row._count._all);
      } else if (row.status === AttendanceStatus.absent) {
        absentByCenter.set(row.centerId, row._count._all);
      }
    }
    const enrolledMap = new Map(enrolledByCenter.map((r) => [r.centerId, r._count._all]));

    const centerSummaries = centers.map((c) => {
      const p = presentByCenter.get(c.id) ?? 0;
      const a = absentByCenter.get(c.id) ?? 0;
      const t = p + a;
      return {
        centerId: c.id,
        centerName: c.name,
        enrolledChildren: enrolledMap.get(c.id) ?? 0,
        present: p,
        absent: a,
        rate: t > 0 ? Math.round((p / t) * 1000) / 10 : null,
      };
    });

    centerSummaries.sort(
      (a, b) => (b.rate ?? -1) - (a.rate ?? -1) || a.centerName.localeCompare(b.centerName),
    );
    const total = centerSummaries.length;
    const items = centerSummaries.slice(skip, skip + pageSize);

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      districtId: scope.districtId,
      centerId: scope.singleCenterId,
      sectorId: scope.sectorId,
      summary: {
        enrolledChildren: enrolled,
        present,
        absent,
        totalRecords,
        attendanceRate: rate,
      },
      trend,
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize) || 1,
    };
  }

  async nutrition(user: AuthUser, query: MonitoringQueryDto) {
    const scope = await resolveDistrictQueryScope(this.prisma, user, query);
    const { from, to } = resolveInclusiveDateRange(query.from, query.to);
    const { page, pageSize, skip } = paginateParams(query.page, query.pageSize);
    const childWhere = childCenterWhere(scope);

    if (scope.centerIds !== 'all' && scope.centerIds.length === 0) {
      return emptyNutrition(from, to, scope, page, pageSize);
    }

    const activeChildren = await this.prisma.child.count({
      where: {
        deletedAt: null,
        status: ChildStatus.active,
        ...childWhere,
      },
    });

    const grouped = await this.prisma.childNutritionScreening.groupBy({
      by: ['nutritionStatus'],
      where: {
        deletedAt: null,
        screeningDate: { gte: from, lte: to },
        child: { deletedAt: null, ...childWhere },
      },
      _count: { _all: true },
    });

    const counts: Record<string, number> = {
      [NutritionStatus.normal]: 0,
      [NutritionStatus.at_risk]: 0,
      [NutritionStatus.moderate]: 0,
      [NutritionStatus.severe]: 0,
    };
    let screenings = 0;
    for (const g of grouped) {
      counts[g.nutritionStatus] = g._count._all;
      screenings += g._count._all;
    }

    const [requiresReferral, overdue, neverScreened, centers, byCenterStatus] = await Promise.all([
      this.prisma.childNutritionScreening.count({
        where: {
          deletedAt: null,
          requiresReferral: true,
          screeningDate: { gte: from, lte: to },
          child: { deletedAt: null, ...childWhere },
        },
      }),
      this.countOverdueScreenings(scope),
      this.countNeverScreened(scope),
      this.loadCenters(scope),
      this.nutritionStatusByCenter(scope, from, to),
    ]);

    const statusByCenter = new Map<string, Record<string, number> & { total: number }>();
    for (const row of byCenterStatus) {
      const cur = statusByCenter.get(row.centerId) ?? {
        normal: 0,
        at_risk: 0,
        moderate: 0,
        severe: 0,
        total: 0,
      };
      cur[row.nutritionStatus] = row.cnt;
      cur.total += row.cnt;
      statusByCenter.set(row.centerId, cur);
    }

    const centerItems = centers.map((c) => {
      const local = statusByCenter.get(c.id);
      return {
        centerId: c.id,
        centerName: c.name,
        screenings: local?.total ?? 0,
        severe: local?.severe ?? 0,
        moderate: local?.moderate ?? 0,
        atRisk: local?.at_risk ?? 0,
        normal: local?.normal ?? 0,
      };
    });

    centerItems.sort((a, b) => b.severe - a.severe);
    const total = centerItems.length;

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      districtId: scope.districtId,
      centerId: scope.singleCenterId,
      summary: {
        activeChildren,
        screenings,
        severe: counts[NutritionStatus.severe],
        moderate: counts[NutritionStatus.moderate],
        atRisk: counts[NutritionStatus.at_risk],
        normal: counts[NutritionStatus.normal],
        requiresReferral,
        overdueScreenings: overdue,
        neverScreened,
        screeningCoverage:
          activeChildren > 0
            ? Math.round(((activeChildren - neverScreened) / activeChildren) * 1000) / 10
            : null,
      },
      items: centerItems.slice(skip, skip + pageSize),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize) || 1,
    };
  }

  async feeding(user: AuthUser, query: MonitoringQueryDto) {
    const scope = await resolveDistrictQueryScope(this.prisma, user, query);
    const { from, to } = resolveInclusiveDateRange(query.from, query.to);
    const { page, pageSize, skip } = paginateParams(query.page, query.pageSize);
    const cWhere = centerIdWhere(scope);

    if (scope.centerIds !== 'all' && scope.centerIds.length === 0) {
      return emptyFeeding(from, to, scope, page, pageSize);
    }

    const centers = await this.loadCenters(scope);
    const dayCount = daysInclusive(from, to);

    const [daysRecorded, milk, porridge, balanced, feedingByCenter] = await Promise.all([
      this.prisma.centerFeedingDay.count({
        where: {
          deletedAt: null,
          recordedDate: { gte: from, lte: to },
          ...cWhere,
        },
      }),
      this.prisma.centerFeedingDay.count({
        where: {
          deletedAt: null,
          milkServed: true,
          recordedDate: { gte: from, lte: to },
          ...cWhere,
        },
      }),
      this.prisma.centerFeedingDay.count({
        where: {
          deletedAt: null,
          porridgeServed: true,
          recordedDate: { gte: from, lte: to },
          ...cWhere,
        },
      }),
      this.prisma.centerFeedingDay.count({
        where: {
          deletedAt: null,
          balancedMealServed: true,
          recordedDate: { gte: from, lte: to },
          ...cWhere,
        },
      }),
      this.prisma.centerFeedingDay.groupBy({
        by: ['centerId'],
        where: {
          deletedAt: null,
          recordedDate: { gte: from, lte: to },
          ...cWhere,
        },
        _count: { _all: true },
      }),
    ]);

    const expected = centers.length * dayCount;
    const recordedMap = new Map(feedingByCenter.map((r) => [r.centerId, r._count._all]));
    const items = centers.map((c) => {
      const recorded = recordedMap.get(c.id) ?? 0;
      return {
        centerId: c.id,
        centerName: c.name,
        daysRecorded: recorded,
        expectedDays: dayCount,
        missingDays: Math.max(0, dayCount - recorded),
        coverage: dayCount > 0 ? Math.round((recorded / dayCount) * 1000) / 10 : null,
      };
    });

    items.sort((a, b) => (a.coverage ?? 0) - (b.coverage ?? 0));
    const missingReports = items.filter((i) => i.missingDays > 0).length;

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      districtId: scope.districtId,
      centerId: scope.singleCenterId,
      summary: {
        daysRecorded,
        daysWithMilk: milk,
        daysWithPorridge: porridge,
        daysWithBalancedMeal: balanced,
        reportingCenters: items.filter((i) => i.daysRecorded > 0).length,
        centersInScope: centers.length,
        expectedDayRecords: expected,
        feedingCoverage: expected > 0 ? Math.round((daysRecorded / expected) * 1000) / 10 : null,
        centersMissingReports: missingReports,
      },
      items: items.slice(skip, skip + pageSize),
      total: items.length,
      page,
      pageSize,
      totalPages: Math.ceil(items.length / pageSize) || 1,
    };
  }

  async sted(user: AuthUser, query: MonitoringQueryDto) {
    const scope = await resolveDistrictQueryScope(this.prisma, user, query);
    const { from, to } = resolveInclusiveDateRange(query.from, query.to);
    const { page, pageSize, skip } = paginateParams(query.page, query.pageSize);
    const cWhere = centerIdWhere(scope);
    const childWhere = childCenterWhere(scope);

    if (scope.centerIds !== 'all' && scope.centerIds.length === 0) {
      return emptySted(from, to, scope, page, pageSize);
    }

    const [assessments, activeChildren, followUpDue] = await Promise.all([
      this.prisma.stedAssessment.findMany({
        where: {
          deletedAt: null,
          assessmentDate: { gte: from, lte: to },
          ...cWhere,
        },
        select: {
          id: true,
          centerId: true,
          ageBand: true,
          outcome: true,
          followUpIn6Months: true,
        },
      }),
      this.prisma.child.count({
        where: {
          deletedAt: null,
          status: ChildStatus.active,
          ...childWhere,
        },
      }),
      this.prisma.stedAssessment.count({
        where: {
          deletedAt: null,
          followUpIn6Months: true,
          followUpDueDate: { lte: to },
          ...cWhere,
        },
      }),
    ]);

    const scores = assessments
      .map((a) => extractStedScore(a.outcome))
      .filter((n): n is number => n != null);
    const averageScore =
      scores.length > 0
        ? Math.round((scores.reduce((s, n) => s + n, 0) / scores.length) * 10) / 10
        : null;

    const byBand: Record<string, number> = {};
    for (const a of assessments) {
      byBand[a.ageBand] = (byBand[a.ageBand] ?? 0) + 1;
    }

    // Outcome distribution from JSON outcome.classification / status if present
    const outcomeDistribution: Record<string, number> = {};
    for (const a of assessments) {
      const key = extractStedClassification(a.outcome) ?? 'unspecified';
      outcomeDistribution[key] = (outcomeDistribution[key] ?? 0) + 1;
    }

    const centers = await this.loadCenters(scope);
    const byCenter = new Map<string, { count: number; scoreSum: number; scoreN: number }>();
    for (const a of assessments) {
      const cur = byCenter.get(a.centerId) ?? {
        count: 0,
        scoreSum: 0,
        scoreN: 0,
      };
      cur.count += 1;
      const score = extractStedScore(a.outcome);
      if (score != null) {
        cur.scoreSum += score;
        cur.scoreN += 1;
      }
      byCenter.set(a.centerId, cur);
    }

    const items = centers.map((c) => {
      const row = byCenter.get(c.id);
      return {
        centerId: c.id,
        centerName: c.name,
        assessmentsCompleted: row?.count ?? 0,
        averageScore:
          row && row.scoreN > 0 ? Math.round((row.scoreSum / row.scoreN) * 10) / 10 : null,
      };
    });
    items.sort((a, b) => b.assessmentsCompleted - a.assessmentsCompleted);

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      districtId: scope.districtId,
      centerId: scope.singleCenterId,
      summary: {
        assessmentsCompleted: assessments.length,
        activeChildren,
        coverage:
          activeChildren > 0 ? Math.round((assessments.length / activeChildren) * 1000) / 10 : null,
        averageScore,
        pendingFollowUps: followUpDue,
        ageBandDistribution: byBand,
        outcomeDistribution,
      },
      items: items.slice(skip, skip + pageSize),
      total: items.length,
      page,
      pageSize,
      totalPages: Math.ceil(items.length / pageSize) || 1,
    };
  }

  async referrals(user: AuthUser, query: MonitoringQueryDto) {
    const scope = await resolveDistrictQueryScope(this.prisma, user, query);
    const { from, to } = resolveInclusiveDateRange(query.from, query.to);
    const { page, pageSize, skip } = paginateParams(query.page, query.pageSize);
    const cWhere = centerIdWhere(scope);
    const staleCutoff = new Date(to);
    staleCutoff.setUTCDate(staleCutoff.getUTCDate() - STALE_REFERRAL_DAYS);

    if (scope.centerIds !== 'all' && scope.centerIds.length === 0) {
      return emptyReferrals(from, to, scope, page, pageSize);
    }

    const [created, pending, completed, cancelled, overdue] = await Promise.all([
      this.prisma.referral.count({
        where: {
          deletedAt: null,
          referralDate: { gte: from, lte: to },
          ...cWhere,
        },
      }),
      this.prisma.referral.count({
        where: {
          deletedAt: null,
          status: ReferralStatus.pending,
          ...cWhere,
        },
      }),
      this.prisma.referral.count({
        where: {
          deletedAt: null,
          status: ReferralStatus.completed,
          referralDate: { gte: from, lte: to },
          ...cWhere,
        },
      }),
      this.prisma.referral.count({
        where: {
          deletedAt: null,
          status: ReferralStatus.cancelled,
          referralDate: { gte: from, lte: to },
          ...cWhere,
        },
      }),
      this.prisma.referral.count({
        where: {
          deletedAt: null,
          status: ReferralStatus.pending,
          referralDate: { lte: staleCutoff },
          ...cWhere,
        },
      }),
    ]);

    const completedRows = await this.prisma.referral.findMany({
      where: {
        deletedAt: null,
        status: ReferralStatus.completed,
        referralDate: { gte: from, lte: to },
        ...cWhere,
      },
      select: { referralDate: true, updatedAt: true },
      take: 2000,
    });

    let averageCompletionDays: number | null = null;
    if (completedRows.length > 0) {
      const sum = completedRows.reduce((acc, r) => {
        const days = (r.updatedAt.getTime() - r.referralDate.getTime()) / (24 * 60 * 60 * 1000);
        return acc + Math.max(0, days);
      }, 0);
      averageCompletionDays = Math.round((sum / completedRows.length) * 10) / 10;
    }

    const [centers, pendingByCenter, completedByCenter, overdueByCenter] = await Promise.all([
      this.loadCenters(scope),
      this.prisma.referral.groupBy({
        by: ['centerId'],
        where: {
          deletedAt: null,
          status: ReferralStatus.pending,
          ...cWhere,
        },
        _count: { _all: true },
      }),
      this.prisma.referral.groupBy({
        by: ['centerId'],
        where: {
          deletedAt: null,
          status: ReferralStatus.completed,
          referralDate: { gte: from, lte: to },
          ...cWhere,
        },
        _count: { _all: true },
      }),
      this.prisma.referral.groupBy({
        by: ['centerId'],
        where: {
          deletedAt: null,
          status: ReferralStatus.pending,
          referralDate: { lte: staleCutoff },
          ...cWhere,
        },
        _count: { _all: true },
      }),
    ]);

    const pendingMap = new Map(pendingByCenter.map((r) => [r.centerId, r._count._all]));
    const completedMap = new Map(completedByCenter.map((r) => [r.centerId, r._count._all]));
    const overdueMap = new Map(overdueByCenter.map((r) => [r.centerId, r._count._all]));

    const items = centers.map((c) => ({
      centerId: c.id,
      centerName: c.name,
      pending: pendingMap.get(c.id) ?? 0,
      completed: completedMap.get(c.id) ?? 0,
      overdue: overdueMap.get(c.id) ?? 0,
    }));
    items.sort((a, b) => b.overdue - a.overdue || b.pending - a.pending);

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      districtId: scope.districtId,
      centerId: scope.singleCenterId,
      summary: {
        created,
        pending,
        completed,
        cancelled,
        overdue,
        averageCompletionDays,
      },
      items: items.slice(skip, skip + pageSize),
      total: items.length,
      page,
      pageSize,
      totalPages: Math.ceil(items.length / pageSize) || 1,
    };
  }

  private async loadCenters(scope: { centerIds: string[] | 'all'; districtId: string | null }) {
    return this.prisma.ecdCenter.findMany({
      where: {
        deletedAt: null,
        ...(scope.centerIds === 'all'
          ? scope.districtId
            ? { districtId: scope.districtId }
            : {}
          : { id: { in: scope.centerIds } }),
      },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  }

  /**
   * Single SQL aggregation for nutrition-by-center (screenings have no centerId).
   * Replaces per-center groupBy fan-out under large NCDA scopes.
   */
  private async nutritionStatusByCenter(
    scope: { centerIds: string[] | 'all'; districtId: string | null },
    from: Date,
    to: Date,
  ): Promise<Array<{ centerId: string; nutritionStatus: string; cnt: number }>> {
    const conditions: Prisma.Sql[] = [
      Prisma.sql`s.deleted_at IS NULL`,
      Prisma.sql`ch.deleted_at IS NULL`,
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
      SELECT
        ch.center_id AS "centerId",
        s.nutrition_status::text AS "nutritionStatus",
        COUNT(*)::int AS cnt
      FROM child_nutrition_screening s
      INNER JOIN child ch ON ch.id = s.child_id
      WHERE ${Prisma.join(conditions, ' AND ')}
      GROUP BY ch.center_id, s.nutrition_status
    `;
  }

  private async attendanceTrend(scope: { centerIds: string[] | 'all' }, from: Date, to: Date) {
    const cWhere = centerIdWhere(scope as never);
    const rows = await this.prisma.attendanceRecord.groupBy({
      by: ['attendanceDate', 'status'],
      where: {
        deletedAt: null,
        attendanceDate: { gte: from, lte: to },
        ...cWhere,
      },
      _count: { _all: true },
      orderBy: { attendanceDate: 'asc' },
    });

    const byDate = new Map<string, { present: number; absent: number }>();
    for (const row of rows) {
      const key = row.attendanceDate.toISOString().slice(0, 10);
      const cur = byDate.get(key) ?? { present: 0, absent: 0 };
      if (row.status === AttendanceStatus.present) {
        cur.present += row._count._all;
      } else {
        cur.absent += row._count._all;
      }
      byDate.set(key, cur);
    }

    return [...byDate.entries()].map(([date, v]) => {
      const total = v.present + v.absent;
      return {
        date,
        present: v.present,
        absent: v.absent,
        rate: total > 0 ? Math.round((v.present / total) * 1000) / 10 : null,
      };
    });
  }

  private async countOverdueScreenings(scope: {
    centerIds: string[] | 'all';
    districtId: string | null;
  }) {
    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() - OVERDUE_SCREENING_DAYS);
    const childWhere = childCenterWhere(scope as never);

    const children = await this.prisma.child.findMany({
      where: {
        deletedAt: null,
        status: ChildStatus.active,
        ...childWhere,
      },
      select: {
        id: true,
        nutritionScreenings: {
          where: { deletedAt: null },
          orderBy: { screeningDate: 'desc' },
          take: 1,
          select: { screeningDate: true },
        },
      },
      take: 5000,
    });

    return children.filter((c) => {
      const latest = c.nutritionScreenings[0];
      return latest && latest.screeningDate < cutoff;
    }).length;
  }

  private async countNeverScreened(scope: {
    centerIds: string[] | 'all';
    districtId: string | null;
  }) {
    const childWhere = childCenterWhere(scope as never);
    return this.prisma.child.count({
      where: {
        deletedAt: null,
        status: ChildStatus.active,
        ...childWhere,
        nutritionScreenings: { none: { deletedAt: null } },
      },
    });
  }
}

function daysInclusive(from: Date, to: Date): number {
  const ms = to.getTime() - from.getTime();
  return Math.floor(ms / (24 * 60 * 60 * 1000)) + 1;
}

function extractStedScore(outcome: unknown): number | null {
  if (!outcome || typeof outcome !== 'object') return null;
  const o = outcome as Record<string, unknown>;
  for (const key of ['score', 'totalScore', 'overallScore', 'percentage']) {
    const v = o[key];
    if (typeof v === 'number' && !Number.isNaN(v)) return v;
  }
  return null;
}

function extractStedClassification(outcome: unknown): string | null {
  if (!outcome || typeof outcome !== 'object') return null;
  const o = outcome as Record<string, unknown>;
  for (const key of ['classification', 'status', 'result', 'level']) {
    const v = o[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

function emptyAttendance(
  from: Date,
  to: Date,
  scope: { districtId: string | null; singleCenterId: string | null; sectorId: string | null },
  page: number,
  pageSize: number,
) {
  return {
    from: from.toISOString(),
    to: to.toISOString(),
    districtId: scope.districtId,
    centerId: scope.singleCenterId,
    sectorId: scope.sectorId,
    summary: {
      enrolledChildren: 0,
      present: 0,
      absent: 0,
      totalRecords: 0,
      attendanceRate: null,
    },
    trend: [],
    items: [],
    total: 0,
    page,
    pageSize,
    totalPages: 1,
  };
}

function emptyNutrition(
  from: Date,
  to: Date,
  scope: { districtId: string | null; singleCenterId: string | null },
  page: number,
  pageSize: number,
) {
  return {
    from: from.toISOString(),
    to: to.toISOString(),
    districtId: scope.districtId,
    centerId: scope.singleCenterId,
    summary: {
      activeChildren: 0,
      screenings: 0,
      severe: 0,
      moderate: 0,
      atRisk: 0,
      normal: 0,
      requiresReferral: 0,
      overdueScreenings: 0,
      neverScreened: 0,
      screeningCoverage: null,
    },
    items: [],
    total: 0,
    page,
    pageSize,
    totalPages: 1,
  };
}

function emptyFeeding(
  from: Date,
  to: Date,
  scope: { districtId: string | null; singleCenterId: string | null },
  page: number,
  pageSize: number,
) {
  return {
    from: from.toISOString(),
    to: to.toISOString(),
    districtId: scope.districtId,
    centerId: scope.singleCenterId,
    summary: {
      daysRecorded: 0,
      daysWithMilk: 0,
      daysWithPorridge: 0,
      daysWithBalancedMeal: 0,
      reportingCenters: 0,
      centersInScope: 0,
      expectedDayRecords: 0,
      feedingCoverage: null,
      centersMissingReports: 0,
    },
    items: [],
    total: 0,
    page,
    pageSize,
    totalPages: 1,
  };
}

function emptySted(
  from: Date,
  to: Date,
  scope: { districtId: string | null; singleCenterId: string | null },
  page: number,
  pageSize: number,
) {
  return {
    from: from.toISOString(),
    to: to.toISOString(),
    districtId: scope.districtId,
    centerId: scope.singleCenterId,
    summary: {
      assessmentsCompleted: 0,
      activeChildren: 0,
      coverage: null,
      averageScore: null,
      pendingFollowUps: 0,
      ageBandDistribution: {},
      outcomeDistribution: {},
    },
    items: [],
    total: 0,
    page,
    pageSize,
    totalPages: 1,
  };
}

function emptyReferrals(
  from: Date,
  to: Date,
  scope: { districtId: string | null; singleCenterId: string | null },
  page: number,
  pageSize: number,
) {
  return {
    from: from.toISOString(),
    to: to.toISOString(),
    districtId: scope.districtId,
    centerId: scope.singleCenterId,
    summary: {
      created: 0,
      pending: 0,
      completed: 0,
      cancelled: 0,
      overdue: 0,
      averageCompletionDays: null,
    },
    items: [],
    total: 0,
    page,
    pageSize,
    totalPages: 1,
  };
}

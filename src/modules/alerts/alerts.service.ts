import {
  AdministrativeLevel,
  AttendanceStatus,
  ChildStatus,
  GapStatus,
  TransferStatus,
  UserRole,
} from '../../common/domain';
import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ReferralStatus } from '@prisma/client';
import {
  assertCenterAccessibleById,
  ecdCenterWhere,
  resolveDistrictQueryScope,
  type DistrictQueryScope,
} from '../../common/scope/district-query.scope';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../auth/interfaces/jwt-payload.interface';
import { decimalToNumber } from '../nutrition/mappers/nutrition.mapper';
import { collectWhoConcerns, worstWhoConcernZone } from '../nutrition/who/concern';
import {
  ATTENDANCE_ABSENT_THRESHOLD,
  ATTENDANCE_RISK_DAYS,
  HIGH_PRIORITY_LOW_RATE_THRESHOLD,
  LOW_CENTER_ATTENDANCE_THRESHOLD,
  attendanceLookbackRange,
  startOfUtcDay,
} from './attendance-alert.constants';
import { FollowUpAlertDto, FollowUpAlertsResponseDto } from './dto/follow-up-alert.dto';
import { FollowUpAlertsQueryDto } from './dto/follow-up-alerts-query.dto';
import {
  FollowUpSummaryNodeDto,
  FollowUpSummaryQueryDto,
  FollowUpSummaryResponseDto,
  type FollowUpSummaryGroupBy,
} from './dto/follow-up-summary.dto';

/** Active children with no screening within this window are overdue. */
const OVERDUE_SCREENING_DAYS = 30;
/** Pending referrals older than this are follow-up risks. */
const STALE_REFERRAL_DAYS = 7;
/** Centers with no attendance recorded today while having active children. */
const DATA_QUALITY_NO_ATTENDANCE = true;
/** Pending transfers older than this are stale. */
const STALE_TRANSFER_DAYS = 7;
/** STED follow-up is considered upcoming within this many days. */
const STED_UPCOMING_DAYS = 7;
/** Centers with no compliance assessment in this many months are lapsed. */
const COMPLIANCE_LAPSE_MONTHS = 6;

@Injectable()
export class AlertsService {
  constructor(private readonly prisma: PrismaService) {}

  async getFollowUpAlerts(
    user: AuthUser,
    query: FollowUpAlertsQueryDto,
  ): Promise<FollowUpAlertsResponseDto> {
    const scope = await this.resolveScope(user, query);
    const category = query.category ?? 'all';
    const limit = query.limit ?? 100;

    if (scope.centerIds !== 'all' && scope.centerIds.length === 0) {
      return emptyResponse(scope);
    }

    const alerts = await this.computeAlerts(scope, category);
    const priorityRank = { high: 0, medium: 1, low: 2 };
    alerts.sort(
      (a, b) =>
        priorityRank[a.priority] - priorityRank[b.priority] ||
        b.detectedAt.localeCompare(a.detectedAt),
    );

    const items = alerts.slice(0, limit);
    const counts = countAlerts(alerts);

    return {
      items,
      total: alerts.length,
      counts,
      districtId: scope.districtId,
      centerId: scope.singleCenterId,
    };
  }

  /**
   * Aggregate operational follow-up alerts by admin grain for Impugukirwa drill-down.
   * Counts derive from the same detectors as GET /alerts/follow-up — not fake geo alerts.
   */
  async getFollowUpSummary(
    user: AuthUser,
    query: FollowUpSummaryQueryDto,
  ): Promise<FollowUpSummaryResponseDto> {
    const scope = await this.resolveSummaryScope(user, query);
    const category = query.category ?? 'all';
    const priorityFilter = query.priority ?? 'all';

    if (scope.centerIds !== 'all' && scope.centerIds.length === 0) {
      return emptySummaryResponse(query.groupBy, scope);
    }

    let alerts = await this.computeAlerts(scope, category);
    if (priorityFilter !== 'all') {
      alerts = alerts.filter((a) => a.priority === priorityFilter);
    }

    const ancestry = await this.loadCenterAncestry(
      alerts.map((a) => a.centerId).filter((id): id is string => Boolean(id)),
    );

    const buckets = new Map<string, FollowUpSummaryNodeDto>();
    for (const alert of alerts) {
      if (!alert.centerId) continue;
      const geo = ancestry.get(alert.centerId);
      if (!geo) continue;
      const key = bucketKey(query.groupBy, geo);
      if (!key) continue;
      let node = buckets.get(key.id);
      if (!node) {
        node = {
          id: key.id,
          name: key.name,
          level: query.groupBy,
          total: 0,
          priorityCounts: { high: 0, medium: 0, low: 0 },
          categoryCounts: emptyCategoryCounts(),
          provinceId: geo.provinceId,
          districtId: geo.districtId,
          sectorId: geo.sectorId,
          centerId: query.groupBy === 'center' ? geo.centerId : null,
        };
        buckets.set(key.id, node);
      }
      node.total += 1;
      node.priorityCounts[alert.priority] += 1;
      node.categoryCounts[alert.category] += 1;
    }

    const items = [...buckets.values()].sort(
      (a, b) =>
        b.priorityCounts.high - a.priorityCounts.high ||
        b.priorityCounts.medium - a.priorityCounts.medium ||
        b.total - a.total ||
        a.name.localeCompare(b.name, 'rw'),
    );

    return {
      groupBy: query.groupBy,
      scope: {
        provinceId: scope.provinceId,
        districtId: scope.districtId,
        sectorId: scope.sectorId,
        centerId: scope.singleCenterId,
      },
      items,
      totalAlerts: alerts.length,
      highPriority: alerts.filter((a) => a.priority === 'high').length,
      generatedAt: new Date().toISOString(),
    };
  }

  private async computeAlerts(
    scope: Scope,
    category: string,
  ): Promise<FollowUpAlertDto[]> {
    // Alert detectors use centerId IN lists; materialize relational province/district/village.
    const effective = await this.materializeCenterScope(scope);
    const alerts: FollowUpAlertDto[] = [];

    if (category === 'all' || category === 'nutrition') {
      alerts.push(...(await this.nutritionAlerts(effective)));
    }
    if (category === 'all' || category === 'attendance') {
      alerts.push(...(await this.attendanceAlerts(effective)));
    }
    if (category === 'all' || category === 'referral') {
      alerts.push(...(await this.referralAlerts(effective)));
    }
    if (category === 'all' || category === 'data_quality') {
      alerts.push(...(await this.dataQualityAlerts(effective)));
    }
    if (category === 'all' || category === 'sted') {
      alerts.push(...(await this.stedFollowUpAlerts(effective)));
      alerts.push(...(await this.stedUpcomingAlerts(effective)));
    }
    if (category === 'all' || category === 'transfer') {
      alerts.push(...(await this.staleTransferAlerts(effective)));
    }
    if (category === 'all' || category === 'compliance') {
      alerts.push(...(await this.complianceGapAlerts(effective)));
      alerts.push(...(await this.complianceLapsedAlerts(effective)));
    }
    if (category === 'all' || category === 'capacity') {
      alerts.push(...(await this.capacityAlerts(effective)));
    }

    return alerts;
  }

  private async resolveSummaryScope(
    user: AuthUser,
    query: FollowUpSummaryQueryDto,
  ): Promise<Scope & { provinceId: string | null; sectorId: string | null }> {
    const base = await resolveDistrictQueryScope(this.prisma, user, {
      provinceId: query.provinceId,
      districtId: query.districtId,
      sectorId: query.sectorId,
      cellId: query.cellId,
      villageId: query.villageId,
      centerId: query.centerId,
    });
    return {
      ...base,
      provinceId: base.provinceId ?? query.provinceId ?? null,
      sectorId: base.sectorId,
    };
  }

  private async loadCenterAncestry(
    centerIds: string[],
  ): Promise<Map<string, CenterAncestry>> {
    const unique = [...new Set(centerIds)];
    const map = new Map<string, CenterAncestry>();
    if (unique.length === 0) return map;

    const centers = await this.prisma.ecdCenter.findMany({
      where: { id: { in: unique }, deletedAt: null },
      select: {
        id: true,
        name: true,
        districtId: true,
        villageId: true,
        district: {
          select: {
            id: true,
            name: true,
            provinceId: true,
            province: { select: { id: true, name: true } },
          },
        },
      },
    });

    const villageIds = [...new Set(centers.map((c) => c.villageId))];
    const sectorByVillage = await this.resolveSectorByVillage(villageIds);

    for (const center of centers) {
      const sector = sectorByVillage.get(center.villageId);
      map.set(center.id, {
        centerId: center.id,
        centerName: center.name,
        districtId: center.district.id,
        districtName: center.district.name,
        provinceId: center.district.province.id,
        provinceName: center.district.province.name,
        sectorId: sector?.id ?? null,
        sectorName: sector?.name ?? null,
      });
    }
    return map;
  }

  /** Walk village → cell → sector for each village id. */
  private async resolveSectorByVillage(
    villageIds: string[],
  ): Promise<Map<string, { id: string; name: string }>> {
    const result = new Map<string, { id: string; name: string }>();
    if (villageIds.length === 0) return result;

    const units = await this.prisma.administrativeUnit.findMany({
      where: { id: { in: villageIds } },
      select: { id: true, level: true, parentId: true, name: true },
    });
    const byId = new Map(units.map((u) => [u.id, u]));
    const missingParents = new Set<string>();
    for (const u of units) {
      if (u.parentId) missingParents.add(u.parentId);
    }

    // Load ancestors in batches until sectors are resolved.
    while (missingParents.size > 0) {
      const batch = [...missingParents].filter((id) => !byId.has(id));
      missingParents.clear();
      if (batch.length === 0) break;
      const parents = await this.prisma.administrativeUnit.findMany({
        where: { id: { in: batch } },
        select: { id: true, level: true, parentId: true, name: true },
      });
      for (const p of parents) {
        byId.set(p.id, p);
        if (p.parentId && !byId.has(p.parentId) && p.level !== AdministrativeLevel.sector) {
          missingParents.add(p.parentId);
        }
      }
    }

    for (const villageId of villageIds) {
      let current = byId.get(villageId);
      const guard = new Set<string>();
      while (current && !guard.has(current.id)) {
        guard.add(current.id);
        if (current.level === AdministrativeLevel.sector) {
          result.set(villageId, { id: current.id, name: current.name });
          break;
        }
        if (!current.parentId) break;
        current = byId.get(current.parentId);
      }
    }
    return result;
  }

  private async nutritionAlerts(scope: Scope): Promise<FollowUpAlertDto[]> {
    const childWhere = this.childScopeWhere(scope);
    const cutoff = daysAgo(OVERDUE_SCREENING_DAYS);
    const activeChildren = await this.prisma.child.findMany({
      where: {
        deletedAt: null,
        status: ChildStatus.active,
        ...childWhere,
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        dateOfBirth: true,
        gender: true,
        centerId: true,
        center: { select: { name: true } },
        nutritionScreenings: {
          where: { deletedAt: null },
          orderBy: { screeningDate: 'desc' },
          take: 1,
          select: {
            id: true,
            screeningDate: true,
            weightKg: true,
            heightCm: true,
            muacCm: true,
            requiresReferral: true,
          },
        },
      },
      take: 2000,
    });

    const alerts: FollowUpAlertDto[] = [];
    const nowIso = new Date().toISOString();

    for (const child of activeChildren) {
      const latest = child.nutritionScreenings[0];
      const childName = `${child.firstName} ${child.lastName}`.trim();

      if (!latest) {
        alerts.push({
          id: `nutrition-never-${child.id}`,
          category: 'nutrition',
          priority: 'medium',
          code: 'NUTRITION_NEVER_SCREENED',
          title: 'No nutrition screening',
          description: `${childName} has never been screened`,
          centerId: child.centerId,
          centerName: child.center.name,
          childId: child.id,
          childName,
          entityType: 'child',
          entityId: child.id,
          detectedAt: nowIso,
          metrics: [{ label: 'Screenings', value: '0' }],
        });
        continue;
      }

      const concerns = collectWhoConcerns({
        dateOfBirth: child.dateOfBirth,
        gender: child.gender,
        screeningDate: latest.screeningDate,
        weightKg: decimalToNumber(latest.weightKg),
        heightCm: decimalToNumber(latest.heightCm),
        muacCm: decimalToNumber(latest.muacCm),
      });
      const worstZone = worstWhoConcernZone(concerns);

      if (worstZone === 'below_minus_3') {
        const primary = concerns.find((h) => h.zone === 'below_minus_3') ?? concerns[0];
        alerts.push({
          id: `nutrition-who-m3-${latest.id}`,
          category: 'nutrition',
          priority: 'high',
          code: 'NUTRITION_WHO_BELOW_MINUS_3',
          title: 'WHO growth below −3 SD',
          description: `${childName}: ${primary.label}`,
          centerId: child.centerId,
          centerName: child.center.name,
          childId: child.id,
          childName,
          entityType: 'child_nutrition_screening',
          entityId: latest.id,
          detectedAt: latest.screeningDate.toISOString(),
          metrics: [
            { label: 'WHO indicator', value: primary.indicator },
            { label: 'WHO zone', value: primary.zone },
          ],
        });
      } else if (worstZone === 'minus_3_to_minus_2') {
        const primary = concerns[0];
        alerts.push({
          id: `nutrition-who-m2-${latest.id}`,
          category: 'nutrition',
          priority: 'medium',
          code: 'NUTRITION_WHO_MINUS_3_TO_MINUS_2',
          title: 'WHO growth −3 to −2 SD',
          description: `${childName}: ${primary.label}`,
          centerId: child.centerId,
          centerName: child.center.name,
          childId: child.id,
          childName,
          entityType: 'child_nutrition_screening',
          entityId: latest.id,
          detectedAt: latest.screeningDate.toISOString(),
          metrics: [
            { label: 'WHO indicator', value: primary.indicator },
            { label: 'WHO zone', value: primary.zone },
          ],
        });
      }

      if (latest.requiresReferral) {
        alerts.push({
          id: `nutrition-referral-flag-${latest.id}`,
          category: 'nutrition',
          priority: 'high',
          code: 'NUTRITION_REQUIRES_REFERRAL',
          title: 'Nutrition requires referral',
          description: `${childName} screening flagged for referral`,
          centerId: child.centerId,
          centerName: child.center.name,
          childId: child.id,
          childName,
          entityType: 'child_nutrition_screening',
          entityId: latest.id,
          detectedAt: latest.screeningDate.toISOString(),
          metrics: [{ label: 'Requires referral', value: 'true' }],
        });
      }

      if (latest.screeningDate < cutoff) {
        alerts.push({
          id: `nutrition-overdue-${child.id}`,
          category: 'nutrition',
          priority: 'medium',
          code: 'NUTRITION_OVERDUE',
          title: 'Overdue nutrition screening',
          description: `${childName} has not been screened in ${OVERDUE_SCREENING_DAYS}+ days`,
          centerId: child.centerId,
          centerName: child.center.name,
          childId: child.id,
          childName,
          entityType: 'child',
          entityId: child.id,
          detectedAt: latest.screeningDate.toISOString(),
          metrics: [
            {
              label: 'Last screening',
              value: latest.screeningDate.toISOString().slice(0, 10),
            },
          ],
        });
      }
    }

    return alerts;
  }

  private async attendanceAlerts(scope: Scope): Promise<FollowUpAlertDto[]> {
    const absence = await this.attendanceAbsenceAlerts(scope);
    const lowRate = await this.attendanceLowRateAlerts(scope);
    return [...absence, ...lowRate];
  }

  private async attendanceAbsenceAlerts(scope: Scope): Promise<FollowUpAlertDto[]> {
    const { from, to } = attendanceLookbackRange();
    const childWhere = this.childScopeWhere(scope);

    const absences = await this.prisma.attendanceRecord.groupBy({
      by: ['childId'],
      where: {
        deletedAt: null,
        status: AttendanceStatus.absent,
        attendanceDate: { gte: from, lte: to },
        child: {
          deletedAt: null,
          status: ChildStatus.active,
          ...childWhere,
        },
      },
      _count: { _all: true },
    });

    const risky = absences.filter((a) => a._count._all >= ATTENDANCE_ABSENT_THRESHOLD);
    if (risky.length === 0) return [];

    const childIds = risky.map((a) => a.childId);
    const children = await this.prisma.child.findMany({
      where: { id: { in: childIds } },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        centerId: true,
        center: { select: { name: true } },
      },
    });
    const byId = new Map(children.map((c) => [c.id, c]));
    const countByChild = new Map(risky.map((a) => [a.childId, a._count._all]));

    const nowIso = new Date().toISOString();
    return childIds.flatMap((id) => {
      const child = byId.get(id);
      if (!child) return [];
      const absentDays = countByChild.get(id) ?? 0;
      const childName = `${child.firstName} ${child.lastName}`.trim();
      return [
        {
          id: `attendance-absent-${id}`,
          category: 'attendance' as const,
          priority: absentDays >= 5 ? ('high' as const) : ('medium' as const),
          code: 'ATTENDANCE_ABSENCE_RISK',
          title: 'Repeated absences',
          description: `${childName} was absent ${absentDays} days in the last ${ATTENDANCE_RISK_DAYS} days`,
          centerId: child.centerId,
          centerName: child.center.name,
          childId: child.id,
          childName,
          entityType: 'child',
          entityId: child.id,
          detectedAt: nowIso,
          metrics: [
            { label: 'Absent days', value: String(absentDays) },
            { label: 'Window days', value: String(ATTENDANCE_RISK_DAYS) },
          ],
        },
      ];
    });
  }

  private async attendanceLowRateAlerts(scope: Scope): Promise<FollowUpAlertDto[]> {
    const { from, to } = attendanceLookbackRange();
    const centerWhere = scope.centerIds === 'all' ? {} : { id: { in: scope.centerIds } };

    const [centers, attByCenter] = await Promise.all([
      this.prisma.ecdCenter.findMany({
        where: {
          deletedAt: null,
          status: 'active',
          ...centerWhere,
          children: {
            some: { deletedAt: null, status: ChildStatus.active },
          },
        },
        select: { id: true, name: true },
        take: 500,
      }),
      this.prisma.attendanceRecord.groupBy({
        by: ['centerId', 'status'],
        where: {
          deletedAt: null,
          attendanceDate: { gte: from, lte: to },
          ...(scope.centerIds === 'all' ? {} : { centerId: { in: scope.centerIds } }),
        },
        _count: { _all: true },
      }),
    ]);

    const presentByCenter = new Map<string, number>();
    const absentByCenter = new Map<string, number>();
    for (const row of attByCenter) {
      if (row.status === AttendanceStatus.present) {
        presentByCenter.set(row.centerId, row._count._all);
      } else if (row.status === AttendanceStatus.absent) {
        absentByCenter.set(row.centerId, row._count._all);
      }
    }

    const nowIso = new Date().toISOString();
    const alerts: FollowUpAlertDto[] = [];
    for (const center of centers) {
      const present = presentByCenter.get(center.id) ?? 0;
      const absent = absentByCenter.get(center.id) ?? 0;
      const total = present + absent;
      if (total === 0) continue;
      const rate = Math.round((present / total) * 100);
      if (rate >= LOW_CENTER_ATTENDANCE_THRESHOLD) continue;

      alerts.push({
        id: `attendance-low-rate-${center.id}`,
        category: 'attendance',
        priority: rate < HIGH_PRIORITY_LOW_RATE_THRESHOLD ? 'high' : 'medium',
        code: 'ATTENDANCE_LOW_RATE',
        title: 'Low attendance rate',
        description: `${center.name} attendance is ${rate}% over the last ${ATTENDANCE_RISK_DAYS} days`,
        centerId: center.id,
        centerName: center.name,
        childId: null,
        childName: null,
        entityType: 'ecd_center',
        entityId: center.id,
        detectedAt: nowIso,
        metrics: [{ label: 'Rate', value: `${rate}%` }],
      });
    }
    return alerts;
  }

  private async referralAlerts(scope: Scope): Promise<FollowUpAlertDto[]> {
    const cutoff = daysAgo(STALE_REFERRAL_DAYS);
    const centerFilter = scope.centerIds === 'all' ? undefined : { in: scope.centerIds };

    const pending = await this.prisma.referral.findMany({
      where: {
        deletedAt: null,
        status: ReferralStatus.pending,
        referralDate: { lte: cutoff },
        ...(centerFilter ? { centerId: centerFilter } : {}),
      },
      include: {
        child: { select: { firstName: true, lastName: true } },
        center: { select: { name: true } },
      },
      orderBy: { referralDate: 'asc' },
      take: 500,
    });

    return pending.map((r) => {
      const childName = `${r.child.firstName} ${r.child.lastName}`.trim();
      const ageDays = Math.floor((Date.now() - r.referralDate.getTime()) / (24 * 60 * 60 * 1000));
      return {
        id: `referral-stale-${r.id}`,
        category: 'referral' as const,
        priority: ageDays >= 14 ? ('high' as const) : ('medium' as const),
        code: 'REFERRAL_FOLLOW_UP',
        title: 'Pending referral follow-up',
        description: `${childName} referral pending for ${ageDays} days`,
        centerId: r.centerId,
        centerName: r.center.name,
        childId: r.childId,
        childName,
        entityType: 'referral',
        entityId: r.id,
        detectedAt: r.referralDate.toISOString(),
        metrics: [
          { label: 'Days pending', value: String(ageDays) },
          { label: 'Source', value: r.sourceType },
        ],
      };
    });
  }

  private async dataQualityAlerts(scope: Scope): Promise<FollowUpAlertDto[]> {
    const alerts: FollowUpAlertDto[] = [];
    const nowIso = new Date().toISOString();
    const childWhere = this.childScopeWhere(scope);

    const phoneIssues = await this.prisma.child.findMany({
      where: {
        deletedAt: null,
        status: ChildStatus.active,
        ...childWhere,
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        centerId: true,
        center: { select: { name: true } },
        guardianPhone: true,
      },
      take: 2000,
    });

    for (const child of phoneIssues) {
      if (child.guardianPhone?.trim()) continue;
      const childName = `${child.firstName} ${child.lastName}`.trim();
      alerts.push({
        id: `dq-phone-${child.id}`,
        category: 'data_quality',
        priority: 'low',
        code: 'DQ_MISSING_GUARDIAN_PHONE',
        title: 'Missing guardian phone',
        description: `${childName} has no guardian phone on file`,
        centerId: child.centerId,
        centerName: child.center.name,
        childId: child.id,
        childName,
        entityType: 'child',
        entityId: child.id,
        detectedAt: nowIso,
        metrics: [{ label: 'Field', value: 'guardianPhone' }],
      });
    }

    if (DATA_QUALITY_NO_ATTENDANCE) {
      const today = startOfUtcDay(new Date());
      const tomorrow = new Date(today);
      tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

      const centerWhere = scope.centerIds === 'all' ? {} : { id: { in: scope.centerIds } };

      const [centersWithChildren, attendedCenterRows] = await Promise.all([
        this.prisma.ecdCenter.findMany({
          where: {
            deletedAt: null,
            status: 'active',
            ...centerWhere,
            children: {
              some: { deletedAt: null, status: ChildStatus.active },
            },
          },
          select: { id: true, name: true },
          take: 500,
        }),
        this.prisma.attendanceRecord.groupBy({
          by: ['centerId'],
          where: {
            deletedAt: null,
            attendanceDate: { gte: today, lt: tomorrow },
            ...(scope.centerIds === 'all' ? {} : { centerId: { in: scope.centerIds } }),
          },
          _count: { _all: true },
        }),
      ]);

      const attended = new Set(attendedCenterRows.map((r) => r.centerId));
      for (const center of centersWithChildren) {
        if (attended.has(center.id)) continue;
        alerts.push({
          id: `dq-no-attendance-${center.id}-${today.toISOString().slice(0, 10)}`,
          category: 'data_quality',
          priority: 'medium',
          code: 'DQ_NO_ATTENDANCE_TODAY',
          title: 'No attendance recorded today',
          description: `${center.name} has active children but no attendance today`,
          centerId: center.id,
          centerName: center.name,
          childId: null,
          childName: null,
          entityType: 'ecd_center',
          entityId: center.id,
          detectedAt: nowIso,
          metrics: [{ label: 'Date', value: today.toISOString().slice(0, 10) }],
        });
      }
    }

    return alerts;
  }

  private async stedFollowUpAlerts(scope: Scope): Promise<FollowUpAlertDto[]> {
    const today = startOfUtcDay(new Date());
    const centerFilter = scope.centerIds === 'all' ? {} : { centerId: { in: scope.centerIds } };

    const overdue = await this.prisma.stedAssessment.findMany({
      where: {
        deletedAt: null,
        followUpIn6Months: true,
        followUpDueDate: { lt: today },
        ...centerFilter,
      },
      include: {
        child: { select: { firstName: true, lastName: true } },
        center: { select: { name: true } },
      },
      orderBy: { followUpDueDate: 'asc' },
      take: 500,
    });

    const nowIso = new Date().toISOString();
    return overdue.map((a) => {
      const childName = `${a.child.firstName} ${a.child.lastName ?? ''}`.trim();
      return {
        id: `sted-overdue-${a.id}`,
        category: 'sted' as const,
        priority: 'high' as const,
        code: 'STED_FOLLOWUP_OVERDUE',
        title: 'STED follow-up overdue',
        description: `${childName} STED follow-up was due ${a.followUpDueDate!.toISOString().slice(0, 10)}`,
        centerId: a.centerId,
        centerName: a.center.name,
        childId: a.childId,
        childName,
        entityType: 'sted_assessment',
        entityId: a.id,
        detectedAt: nowIso,
        metrics: [{ label: 'Due date', value: a.followUpDueDate!.toISOString().slice(0, 10) }],
      };
    });
  }

  private async stedUpcomingAlerts(scope: Scope): Promise<FollowUpAlertDto[]> {
    const today = startOfUtcDay(new Date());
    const upcoming = new Date(today);
    upcoming.setUTCDate(upcoming.getUTCDate() + STED_UPCOMING_DAYS);
    const centerFilter = scope.centerIds === 'all' ? {} : { centerId: { in: scope.centerIds } };

    const rows = await this.prisma.stedAssessment.findMany({
      where: {
        deletedAt: null,
        followUpIn6Months: true,
        followUpDueDate: { gte: today, lte: upcoming },
        ...centerFilter,
      },
      include: {
        child: { select: { firstName: true, lastName: true } },
        center: { select: { name: true } },
      },
      take: 500,
    });

    const nowIso = new Date().toISOString();
    return rows.map((a) => {
      const childName = `${a.child.firstName} ${a.child.lastName ?? ''}`.trim();
      return {
        id: `sted-upcoming-${a.id}`,
        category: 'sted' as const,
        priority: 'medium' as const,
        code: 'STED_FOLLOWUP_UPCOMING',
        title: 'STED follow-up due soon',
        description: `${childName} STED follow-up due ${a.followUpDueDate!.toISOString().slice(0, 10)}`,
        centerId: a.centerId,
        centerName: a.center.name,
        childId: a.childId,
        childName,
        entityType: 'sted_assessment',
        entityId: a.id,
        detectedAt: nowIso,
        metrics: [{ label: 'Due date', value: a.followUpDueDate!.toISOString().slice(0, 10) }],
      };
    });
  }

  private async staleTransferAlerts(scope: Scope): Promise<FollowUpAlertDto[]> {
    const cutoff = daysAgo(STALE_TRANSFER_DAYS);
    const centerFilter =
      scope.centerIds === 'all'
        ? {}
        : {
            OR: [
              { fromCenterId: { in: scope.centerIds } },
              { toCenterId: { in: scope.centerIds } },
            ],
          };

    const rows = await this.prisma.childTransfer.findMany({
      where: {
        deletedAt: null,
        status: TransferStatus.pending,
        createdAt: { lte: cutoff },
        ...centerFilter,
      },
      include: {
        child: { select: { firstName: true, lastName: true } },
        fromCenter: { select: { name: true } },
        toCenter: { select: { name: true } },
      },
      take: 500,
    });

    const nowIso = new Date().toISOString();
    return rows.map((t) => {
      const childName = `${t.child.firstName} ${t.child.lastName ?? ''}`.trim();
      const ageDays = Math.floor((Date.now() - t.createdAt.getTime()) / (24 * 60 * 60 * 1000));
      return {
        id: `transfer-stale-${t.id}`,
        category: 'transfer' as const,
        priority: ageDays >= 14 ? ('high' as const) : ('medium' as const),
        code: 'TRANSFER_PENDING_STALE',
        title: 'Stale pending transfer',
        description: `${childName} transfer pending for ${ageDays} days`,
        centerId: t.fromCenterId,
        centerName: t.fromCenter.name,
        childId: t.childId,
        childName,
        entityType: 'child_transfer',
        entityId: t.id,
        detectedAt: nowIso,
        metrics: [
          { label: 'Days pending', value: String(ageDays) },
          { label: 'To', value: t.toCenter.name },
        ],
      };
    });
  }

  private async complianceGapAlerts(scope: Scope): Promise<FollowUpAlertDto[]> {
    const today = startOfUtcDay(new Date());
    const centerFilter =
      scope.centerIds === 'all'
        ? {}
        : {
            assessment: { centerId: { in: scope.centerIds } },
          };

    const items = await this.prisma.complianceAssessmentItem.findMany({
      where: {
        deletedAt: null,
        gapTargetDate: { lt: today },
        gapStatus: { not: GapStatus.resolved },
        ...centerFilter,
      },
      include: {
        assessment: {
          select: {
            centerId: true,
            center: { select: { name: true } },
          },
        },
        standard: { select: { code: true, title: true } },
      },
      take: 500,
    });

    const nowIso = new Date().toISOString();
    return items.map((item) => ({
      id: `compliance-gap-${item.id}`,
      category: 'compliance' as const,
      priority: 'high' as const,
      code: 'COMPLIANCE_GAP_OVERDUE',
      title: 'Compliance gap overdue',
      description: `${item.standard.title} gap at ${item.assessment.center.name} is overdue`,
      centerId: item.assessment.centerId,
      centerName: item.assessment.center.name,
      childId: null,
      childName: null,
      entityType: 'compliance_assessment_item',
      entityId: item.id,
      detectedAt: nowIso,
      metrics: [
        { label: 'Standard', value: item.standard.code },
        { label: 'Target date', value: item.gapTargetDate!.toISOString().slice(0, 10) },
      ],
    }));
  }

  private async complianceLapsedAlerts(scope: Scope): Promise<FollowUpAlertDto[]> {
    const cutoff = new Date();
    cutoff.setUTCMonth(cutoff.getUTCMonth() - COMPLIANCE_LAPSE_MONTHS);
    const centerWhere = scope.centerIds === 'all' ? {} : { id: { in: scope.centerIds } };

    const centers = await this.prisma.ecdCenter.findMany({
      where: {
        deletedAt: null,
        status: 'active',
        ...centerWhere,
        children: { some: { deletedAt: null, status: ChildStatus.active } },
      },
      select: {
        id: true,
        name: true,
        complianceAssessments: {
          where: { deletedAt: null },
          orderBy: { assessmentDate: 'desc' },
          take: 1,
          select: { assessmentDate: true },
        },
      },
      take: 500,
    });

    const nowIso = new Date().toISOString();
    return centers
      .filter((c) => {
        const last = c.complianceAssessments[0];
        return !last || last.assessmentDate < cutoff;
      })
      .map((c) => ({
        id: `compliance-lapsed-${c.id}`,
        category: 'compliance' as const,
        priority: 'medium' as const,
        code: 'COMPLIANCE_LAPSED',
        title: 'No recent compliance assessment',
        description: `${c.name} has no compliance assessment in ${COMPLIANCE_LAPSE_MONTHS}+ months`,
        centerId: c.id,
        centerName: c.name,
        childId: null,
        childName: null,
        entityType: 'ecd_center',
        entityId: c.id,
        detectedAt: nowIso,
        metrics: [
          {
            label: 'Last assessment',
            value: c.complianceAssessments[0]?.assessmentDate.toISOString().slice(0, 10) ?? 'Never',
          },
        ],
      }));
  }

  private async capacityAlerts(scope: Scope): Promise<FollowUpAlertDto[]> {
    const centerWhere = scope.centerIds === 'all' ? {} : { id: { in: scope.centerIds } };

    const centers = await this.prisma.ecdCenter.findMany({
      where: {
        deletedAt: null,
        status: 'active',
        capacity: { not: null },
        ...centerWhere,
      },
      select: {
        id: true,
        name: true,
        capacity: true,
        _count: {
          select: {
            children: { where: { deletedAt: null, status: ChildStatus.active } },
          },
        },
      },
      take: 500,
    });

    const nowIso = new Date().toISOString();
    return centers
      .filter((c) => c.capacity != null && c._count.children >= c.capacity)
      .map((c) => ({
        id: `capacity-${c.id}`,
        category: 'capacity' as const,
        priority: 'medium' as const,
        code: 'CENTER_AT_CAPACITY',
        title: 'Center at or over capacity',
        description: `${c.name} has ${c._count.children} children (capacity: ${c.capacity})`,
        centerId: c.id,
        centerName: c.name,
        childId: null,
        childName: null,
        entityType: 'ecd_center',
        entityId: c.id,
        detectedAt: nowIso,
        metrics: [
          { label: 'Children', value: String(c._count.children) },
          { label: 'Capacity', value: String(c.capacity) },
        ],
      }));
  }

  private childScopeWhere(scope: Scope): {
    centerId?: { in: string[] };
  } {
    if (scope.centerIds === 'all') return {};
    return { centerId: { in: scope.centerIds } };
  }

  /**
   * Expand relational geography (province/district/village with centerIds:'all')
   * into concrete center IDs for alert detectors that use IN filters.
   * National remains 'all' (unfiltered).
   */
  private async materializeCenterScope(scope: Scope): Promise<Scope> {
    if (scope.centerIds !== 'all') return scope;
    if (!scope.provinceId && !scope.districtId && !scope.villageId) {
      return scope;
    }
    const centers = await this.prisma.ecdCenter.findMany({
      where: ecdCenterWhere(scope),
      select: { id: true },
    });
    return {
      ...scope,
      centerIds: centers.map((c) => c.id),
    };
  }

  private async resolveScope(user: AuthUser, query: FollowUpAlertsQueryDto): Promise<Scope> {
    return resolveDistrictQueryScope(this.prisma, user, {
      provinceId: query.provinceId,
      districtId: query.districtId,
      sectorId: query.sectorId,
      cellId: query.cellId,
      villageId: query.villageId,
      centerId: query.centerId,
    });
  }
}

type Scope = DistrictQueryScope;

type CenterAncestry = {
  centerId: string;
  centerName: string;
  districtId: string;
  districtName: string;
  provinceId: string;
  provinceName: string;
  sectorId: string | null;
  sectorName: string | null;
};

function countAlerts(alerts: FollowUpAlertDto[]) {
  return {
    nutrition: alerts.filter((a) => a.category === 'nutrition').length,
    attendance: alerts.filter((a) => a.category === 'attendance').length,
    referral: alerts.filter((a) => a.category === 'referral').length,
    data_quality: alerts.filter((a) => a.category === 'data_quality').length,
    sted: alerts.filter((a) => a.category === 'sted').length,
    transfer: alerts.filter((a) => a.category === 'transfer').length,
    compliance: alerts.filter((a) => a.category === 'compliance').length,
    capacity: alerts.filter((a) => a.category === 'capacity').length,
    high: alerts.filter((a) => a.priority === 'high').length,
  };
}

function emptyCategoryCounts() {
  return {
    nutrition: 0,
    attendance: 0,
    referral: 0,
    data_quality: 0,
    sted: 0,
    transfer: 0,
    compliance: 0,
    capacity: 0,
  };
}

function emptyResponse(scope: Scope): FollowUpAlertsResponseDto {
  return {
    items: [],
    total: 0,
    counts: {
      nutrition: 0,
      attendance: 0,
      referral: 0,
      data_quality: 0,
      sted: 0,
      transfer: 0,
      compliance: 0,
      capacity: 0,
      high: 0,
    },
    districtId: scope.districtId,
    centerId: scope.singleCenterId,
  };
}

function emptySummaryResponse(
  groupBy: FollowUpSummaryGroupBy,
  scope: Scope & { provinceId: string | null; sectorId: string | null },
): FollowUpSummaryResponseDto {
  return {
    groupBy,
    scope: {
      provinceId: scope.provinceId,
      districtId: scope.districtId,
      sectorId: scope.sectorId,
      centerId: scope.singleCenterId,
    },
    items: [],
    totalAlerts: 0,
    highPriority: 0,
    generatedAt: new Date().toISOString(),
  };
}

function bucketKey(
  groupBy: FollowUpSummaryGroupBy,
  geo: CenterAncestry,
): { id: string; name: string } | null {
  switch (groupBy) {
    case 'province':
      return { id: geo.provinceId, name: geo.provinceName };
    case 'district':
      return { id: geo.districtId, name: geo.districtName };
    case 'sector':
      if (!geo.sectorId || !geo.sectorName) return null;
      return { id: geo.sectorId, name: geo.sectorName };
    case 'center':
      return { id: geo.centerId, name: geo.centerName };
    default:
      return null;
  }
}

function daysAgo(days: number): Date {
  const d = startOfUtcDay(new Date());
  d.setUTCDate(d.getUTCDate() - days);
  return d;
}

import {
  AttendanceStatus,
  ChildStatus,
  GapStatus,
  TransferStatus,
  UserRole,
} from '../../common/domain';
import { ReferralStatus } from '@prisma/client';
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ATTENDANCE_ABSENT_THRESHOLD,
  ATTENDANCE_RISK_DAYS,
  HIGH_PRIORITY_LOW_RATE_THRESHOLD,
  LOW_CENTER_ATTENDANCE_THRESHOLD,
  attendanceLookbackRange,
  startOfUtcDay,
} from '../alerts/attendance-alert.constants';
import { NotificationsService } from './notifications.service';
import { NotificationDedupeKeys } from './notification-dedupe';

const STED_UPCOMING_DAYS = 7;
const STALE_TRANSFER_DAYS = 7;
const ATTENDANCE_NOTIFY_LIMIT = 500;

/** Matches alerts.service.ts STALE_REFERRAL_DAYS */
const STALE_REFERRAL_DAYS = 7;
/** Matches alerts.service.ts OVERDUE_SCREENING_DAYS */
const OVERDUE_SCREENING_DAYS = 30;

@Injectable()
export class NotificationCronService {
  private readonly logger = new Logger(NotificationCronService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron('0 6 * * *', { name: 'daily-notifications', timeZone: 'UTC' })
  async handleDailyNotifications(): Promise<void> {
    this.logger.log('Running daily notification cron job');
    const batchDate = new Date().toISOString().slice(0, 10);

    const jobs = [
      { name: 'sted_followup_due_soon', run: () => this.notifyStedFollowUps(batchDate) },
      { name: 'compliance_gap_overdue', run: () => this.notifyComplianceGaps(batchDate) },
      { name: 'stale_transfer_requests', run: () => this.notifyStaleTransfers(batchDate) },
      { name: 'stale_referrals', run: () => this.notifyStaleReferrals(batchDate) },
      { name: 'nutrition_overdue_screening', run: () => this.notifyNutritionOverdue(batchDate) },
      { name: 'capacity_warnings', run: () => this.notifyCapacity(batchDate) },
      { name: 'attendance_absence_risk', run: () => this.notifyAttendanceAbsence(batchDate) },
      { name: 'attendance_low_rate', run: () => this.notifyAttendanceLowRate(batchDate) },
    ] as const;

    const results = await Promise.allSettled(jobs.map((j) => j.run()));
    results.forEach((result, idx) => {
      if (result.status === 'rejected') {
        const err = result.reason;
        this.logger.error(
          `Daily notification cron branch failed (job=${jobs[idx].name}, batchDate=${batchDate})`,
          err instanceof Error ? err.stack : String(err),
        );
      }
    });

    this.logger.log('Daily notification cron job completed');
  }

  private async notifyStedFollowUps(batchDate: string): Promise<void> {
    const today = startOfUtcDay(new Date());
    const upcoming = new Date(today);
    upcoming.setUTCDate(upcoming.getUTCDate() + STED_UPCOMING_DAYS);

    const assessments = await this.prisma.stedAssessment.findMany({
      where: {
        deletedAt: null,
        followUpIn6Months: true,
        followUpDueDate: { gte: today, lte: upcoming },
      },
      select: {
        id: true,
        centerId: true,
        childId: true,
        followUpDueDate: true,
        child: { select: { firstName: true, lastName: true } },
      },
      take: 1000,
    });

    for (const a of assessments) {
      const childName = `${a.child.firstName} ${a.child.lastName ?? ''}`.trim();
      const userIds = await this.notifications.findUserIdsByRoleAndCenter(a.centerId, [
        UserRole.ecd_director,
        UserRole.caregiver,
      ]);
      await this.notifications.createForMultipleUsers(userIds, {
        type: 'sted_followup',
        title: 'STED follow-up due soon',
        message: `${childName} STED follow-up due ${a.followUpDueDate!.toISOString().slice(0, 10)}.`,
        entityType: 'sted_assessment',
        entityId: a.id,
        dedupeKey: NotificationDedupeKeys.stedFollowUpCronUpcoming(a.id),
        metadata: { cronBatchDate: batchDate },
      });
    }

    this.logger.log(`Sent STED follow-up notifications for ${assessments.length} assessments`);
  }

  private async notifyComplianceGaps(batchDate: string): Promise<void> {
    const today = startOfUtcDay(new Date());

    const items = await this.prisma.complianceAssessmentItem.findMany({
      where: {
        deletedAt: null,
        gapTargetDate: { lt: today },
        gapStatus: { not: GapStatus.resolved },
      },
      select: {
        id: true,
        assessment: {
          select: {
            centerId: true,
            center: { select: { name: true } },
          },
        },
        standard: { select: { title: true } },
      },
      take: 1000,
    });

    for (const item of items) {
      const userIds = await this.notifications.findUserIdsByRoleAndCenter(
        item.assessment.centerId,
        [UserRole.ecd_director],
      );
      await this.notifications.createForMultipleUsers(userIds, {
        type: 'compliance_update',
        title: 'Compliance gap overdue',
        message: `${item.standard.title} gap at ${item.assessment.center.name} is past its target date.`,
        entityType: 'compliance_assessment_item',
        entityId: item.id,
        dedupeKey: NotificationDedupeKeys.complianceGapCronOverdue(item.id),
        metadata: { cronBatchDate: batchDate },
      });
    }

    this.logger.log(`Sent compliance gap notifications for ${items.length} items`);
  }

  private async notifyStaleTransfers(batchDate: string): Promise<void> {
    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() - STALE_TRANSFER_DAYS);

    const transfers = await this.prisma.childTransfer.findMany({
      where: {
        deletedAt: null,
        status: TransferStatus.pending,
        createdAt: { lte: cutoff },
      },
      select: {
        id: true,
        toCenterId: true,
        child: { select: { firstName: true, lastName: true } },
      },
      take: 1000,
    });

    for (const t of transfers) {
      const childName = `${t.child.firstName} ${t.child.lastName ?? ''}`.trim();
      const userIds = await this.notifications.findUserIdsByRoleAndCenter(t.toCenterId, [
        UserRole.ecd_director,
      ]);
      await this.notifications.createForMultipleUsers(userIds, {
        type: 'transfer_request',
        title: 'Pending transfer reminder',
        message: `Transfer for ${childName} has been pending for ${STALE_TRANSFER_DAYS}+ days.`,
        entityType: 'child_transfer',
        entityId: t.id,
        dedupeKey: NotificationDedupeKeys.transferCronStale(t.id),
        metadata: { cronBatchDate: batchDate },
      });
    }

    this.logger.log(`Sent stale transfer notifications for ${transfers.length} transfers`);
  }

  private async notifyStaleReferrals(batchDate: string): Promise<void> {
    const cutoff = startOfUtcDay(new Date());
    cutoff.setUTCDate(cutoff.getUTCDate() - STALE_REFERRAL_DAYS);

    const referrals = await this.prisma.referral.findMany({
      where: {
        deletedAt: null,
        status: ReferralStatus.pending,
        referralDate: { lte: cutoff },
      },
      select: {
        id: true,
        centerId: true,
        childId: true,
        referralDate: true,
        sourceType: true,
        child: { select: { firstName: true, lastName: true } },
        center: {
          select: {
            name: true,
            districtId: true,
            district: { select: { name: true } },
          },
        },
      },
      take: 1000,
    });

    let sent = 0;
    for (const r of referrals) {
      const childName = `${r.child.firstName} ${r.child.lastName ?? ''}`.trim();
      const ageDays = Math.floor((Date.now() - r.referralDate.getTime()) / (24 * 60 * 60 * 1000));

      const [centerUserIds, districtUserIds] = await Promise.all([
        this.notifications.findUserIdsByRoleAndCenter(r.centerId, [
          UserRole.ecd_director,
          UserRole.caregiver,
        ]),
        this.notifications.findUserIdsByRoleAndDistrict(r.center.districtId, [
          UserRole.district_focal_person,
        ]),
      ]);
      const userIds = [...new Set([...centerUserIds, ...districtUserIds])];

      await this.notifications.createForMultipleUsers(userIds, {
        type: 'referral_updated',
        title: 'Referral pending follow-up',
        message: `${childName}'s referral has been pending for ${ageDays} days.`,
        entityType: 'referral',
        entityId: r.id,
        dedupeKey: NotificationDedupeKeys.referralCronStale(r.id),
        metadata: {
          cronBatchDate: batchDate,
          code: 'REFERRAL_STALE',
          childId: r.childId,
          childName,
          centerName: r.center.name,
          districtName: r.center.district?.name ?? null,
          ageDays,
          threshold: STALE_REFERRAL_DAYS,
          priority: ageDays >= 14 ? 'high' : 'medium',
        },
      });
      sent += 1;
    }

    this.logger.log(`Sent stale referral notifications for ${sent} referrals`);
  }

  private async notifyNutritionOverdue(batchDate: string): Promise<void> {
    const cutoff = startOfUtcDay(new Date());
    cutoff.setUTCDate(cutoff.getUTCDate() - OVERDUE_SCREENING_DAYS);

    const activeChildren = await this.prisma.child.findMany({
      where: {
        deletedAt: null,
        status: ChildStatus.active,
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        centerId: true,
        center: {
          select: {
            name: true,
            districtId: true,
            district: { select: { name: true } },
          },
        },
        nutritionScreenings: {
          where: { deletedAt: null },
          orderBy: { screeningDate: 'desc' as const },
          take: 1,
          select: { id: true, screeningDate: true },
        },
      },
      take: 2000,
    });

    let sent = 0;
    for (const child of activeChildren) {
      const latest = child.nutritionScreenings[0];
      const childName = `${child.firstName} ${child.lastName ?? ''}`.trim();

      if (!latest) {
        // Never screened — distinct condition
        const [centerUserIds, districtUserIds] = await Promise.all([
          this.notifications.findUserIdsByRoleAndCenter(child.centerId, [
            UserRole.ecd_director,
            UserRole.caregiver,
          ]),
          this.notifications.findUserIdsByRoleAndDistrict(child.center.districtId, [
            UserRole.district_focal_person,
          ]),
        ]);
        const userIds = [...new Set([...centerUserIds, ...districtUserIds])];

        await this.notifications.createForMultipleUsers(userIds, {
          type: 'nutrition_alert',
          title: 'Nutrition screening required',
          message: `${childName} has never been screened for nutrition.`,
          entityType: 'child',
          entityId: child.id,
          dedupeKey: NotificationDedupeKeys.nutritionNeverScreenedCron(child.id),
          metadata: {
            cronBatchDate: batchDate,
            code: 'NUTRITION_NEVER_SCREENED',
            childId: child.id,
            childName,
            centerName: child.center.name,
            districtName: child.center.district?.name ?? null,
          },
        });
        sent += 1;
        continue;
      }

      if (latest.screeningDate < cutoff) {
        // Overdue screening
        const lastScreeningDate = latest.screeningDate.toISOString().slice(0, 10);
        const [centerUserIds, districtUserIds] = await Promise.all([
          this.notifications.findUserIdsByRoleAndCenter(child.centerId, [
            UserRole.ecd_director,
            UserRole.caregiver,
          ]),
          this.notifications.findUserIdsByRoleAndDistrict(child.center.districtId, [
            UserRole.district_focal_person,
          ]),
        ]);
        const userIds = [...new Set([...centerUserIds, ...districtUserIds])];

        await this.notifications.createForMultipleUsers(userIds, {
          type: 'nutrition_alert',
          title: 'Overdue nutrition screening',
          message: `${childName} has not been screened in ${OVERDUE_SCREENING_DAYS}+ days (last: ${lastScreeningDate}).`,
          entityType: 'child',
          entityId: child.id,
          dedupeKey: NotificationDedupeKeys.nutritionOverdueCron(child.id, lastScreeningDate),
          metadata: {
            cronBatchDate: batchDate,
            code: 'NUTRITION_OVERDUE',
            childId: child.id,
            childName,
            centerName: child.center.name,
            districtName: child.center.district?.name ?? null,
            lastScreeningDate,
            threshold: OVERDUE_SCREENING_DAYS,
          },
        });
        sent += 1;
      }
    }

    this.logger.log(`Sent nutrition overdue/never-screened notifications for ${sent} children`);
  }

  private async notifyCapacity(batchDate: string): Promise<void> {
    const centers = await this.prisma.ecdCenter.findMany({
      where: {
        deletedAt: null,
        status: 'active',
        capacity: { not: null },
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
      take: 1000,
    });

    const overCapacity = centers.filter(
      (c) => c.capacity != null && c._count.children >= c.capacity,
    );

    for (const c of overCapacity) {
      const userIds = await this.notifications.findUserIdsByRoleAndCenter(c.id, [
        UserRole.ecd_director,
      ]);
      await this.notifications.createForMultipleUsers(userIds, {
        type: 'capacity_warning',
        title: 'Center at capacity',
        message: `${c.name} has ${c._count.children} children (capacity: ${c.capacity}).`,
        entityType: 'ecd_center',
        entityId: c.id,
        dedupeKey: NotificationDedupeKeys.capacityCronAtCapacity(c.id),
        metadata: { cronBatchDate: batchDate },
      });
    }

    this.logger.log(`Sent capacity notifications for ${overCapacity.length} centers`);
  }

  private async notifyAttendanceAbsence(batchDate: string): Promise<void> {
    const { from, to } = attendanceLookbackRange();

    const absences = await this.prisma.attendanceRecord.groupBy({
      by: ['childId'],
      where: {
        deletedAt: null,
        status: AttendanceStatus.absent,
        attendanceDate: { gte: from, lte: to },
        child: {
          deletedAt: null,
          status: ChildStatus.active,
        },
      },
      _count: { _all: true },
    });

    const risky = absences
      .filter((a) => a._count._all >= ATTENDANCE_ABSENT_THRESHOLD)
      .slice(0, ATTENDANCE_NOTIFY_LIMIT);
    if (risky.length === 0) {
      this.logger.log('Sent attendance absence notifications for 0 children');
      return;
    }

    const children = await this.prisma.child.findMany({
      where: { id: { in: risky.map((a) => a.childId) } },
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

    let sent = 0;
    for (const row of risky) {
      const child = byId.get(row.childId);
      if (!child) continue;
      const absentDays = countByChild.get(child.id) ?? row._count._all;
      const childName = `${child.firstName} ${child.lastName ?? ''}`.trim();
      const userIds = await this.notifications.findUserIdsByRoleAndCenter(child.centerId, [
        UserRole.ecd_director,
        UserRole.caregiver,
      ]);
      await this.notifications.createForMultipleUsers(userIds, {
        type: 'attendance_absence',
        title: 'Repeated absences',
        message: `${childName} was absent ${absentDays} days in the last ${ATTENDANCE_RISK_DAYS} days.`,
        entityType: 'child',
        entityId: child.id,
        dedupeKey: NotificationDedupeKeys.attendanceAbsenceCron(child.id, to),
        metadata: {
          cronBatchDate: batchDate,
          code: 'ATTENDANCE_ABSENCE_RISK',
          childId: child.id,
          childName,
          centerName: child.center.name,
          absentDays,
        },
      });
      sent += 1;
    }

    this.logger.log(`Sent attendance absence notifications for ${sent} children`);
  }

  private async notifyAttendanceLowRate(batchDate: string): Promise<void> {
    const { from, to } = attendanceLookbackRange();

    const [centers, attByCenter] = await Promise.all([
      this.prisma.ecdCenter.findMany({
        where: {
          deletedAt: null,
          status: 'active',
          children: { some: { deletedAt: null, status: ChildStatus.active } },
        },
        select: { id: true, name: true, districtId: true },
        take: 1000,
      }),
      this.prisma.attendanceRecord.groupBy({
        by: ['centerId', 'status'],
        where: {
          deletedAt: null,
          attendanceDate: { gte: from, lte: to },
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

    const lowRate = centers.filter((c) => {
      const present = presentByCenter.get(c.id) ?? 0;
      const absent = absentByCenter.get(c.id) ?? 0;
      const total = present + absent;
      if (total === 0) return false;
      const rate = Math.round((present / total) * 100);
      return rate < LOW_CENTER_ATTENDANCE_THRESHOLD;
    });

    for (const c of lowRate) {
      const present = presentByCenter.get(c.id) ?? 0;
      const absent = absentByCenter.get(c.id) ?? 0;
      const rate = Math.round((present / (present + absent)) * 100);
      const [centerUserIds, districtUserIds] = await Promise.all([
        this.notifications.findUserIdsByRoleAndCenter(c.id, [
          UserRole.ecd_director,
          UserRole.caregiver,
        ]),
        this.notifications.findUserIdsByRoleAndDistrict(c.districtId, [
          UserRole.district_focal_person,
        ]),
      ]);
      const userIds = [...new Set([...centerUserIds, ...districtUserIds])];
      await this.notifications.createForMultipleUsers(userIds, {
        type: 'attendance_low_rate',
        title: 'Low attendance rate',
        message: `${c.name} attendance is ${rate}% over the last ${ATTENDANCE_RISK_DAYS} days.`,
        entityType: 'ecd_center',
        entityId: c.id,
        dedupeKey: NotificationDedupeKeys.attendanceLowRateCron(c.id, to),
        metadata: {
          cronBatchDate: batchDate,
          code: 'ATTENDANCE_LOW_RATE',
          centerName: c.name,
          rate,
          priority: rate < HIGH_PRIORITY_LOW_RATE_THRESHOLD ? 'high' : 'medium',
        },
      });
    }

    this.logger.log(`Sent attendance low-rate notifications for ${lowRate.length} centers`);
  }
}

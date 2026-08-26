import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AttendanceStatus, ChildStatus, GapStatus, TransferStatus, UserRole } from '@prisma/client';
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

const STED_UPCOMING_DAYS = 7;
const STALE_TRANSFER_DAYS = 7;
const ATTENDANCE_NOTIFY_LIMIT = 500;

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

    await Promise.allSettled([
      this.notifyStedFollowUps(batchDate),
      this.notifyComplianceGaps(batchDate),
      this.notifyStaleTransfers(batchDate),
      this.notifyCapacity(batchDate),
      this.notifyAttendanceAbsence(batchDate),
      this.notifyAttendanceLowRate(batchDate),
    ]);

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
        metadata: { cronBatchDate: batchDate },
      });
    }

    this.logger.log(`Sent stale transfer notifications for ${transfers.length} transfers`);
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

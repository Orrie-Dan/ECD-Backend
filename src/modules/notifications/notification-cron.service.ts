import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ChildStatus, GapStatus, TransferStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from './notifications.service';

const STED_UPCOMING_DAYS = 7;
const STALE_TRANSFER_DAYS = 7;

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
}

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

import {
  AssessmentStatus,
  ChildStatus,
  NutritionStatus,
  TransferStatus,
  asDomainEnum,
} from '../../common/domain';
import { Injectable } from '@nestjs/common';
import { ReferralStatus } from '@prisma/client';
import { NotificationEventsService } from '../notifications/notification-events.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SyncableEntityType } from './sync.constants';

@Injectable()
export class SyncNotificationBridgeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationEvents: NotificationEventsService,
  ) {}

  async afterEntityCreated(entityType: SyncableEntityType, entityId: string): Promise<void> {
    switch (entityType) {
      case 'child_nutrition_screening':
        await this.afterNutritionScreeningCreated(entityId);
        break;
      case 'sted_assessment':
        await this.afterStedAssessmentCreated(entityId);
        break;
      case 'referral':
        await this.afterReferralCreated(entityId);
        break;
      case 'child':
        await this.afterChildCreated(entityId);
        break;
      case 'ecd_center':
        await this.afterCenterCreated(entityId);
        break;
      default:
        break;
    }
  }

  async afterTransferCreated(transferId: string): Promise<void> {
    const transfer = await this.prisma.childTransfer.findUnique({
      where: { id: transferId },
      select: {
        id: true,
        toCenterId: true,
        child: { select: { firstName: true } },
      },
    });
    if (!transfer) return;

    await this.notificationEvents.onTransferRequested({
      transferId: transfer.id,
      toCenterId: transfer.toCenterId,
      childFirstName: transfer.child.firstName,
    });
  }

  async afterTransferAccepted(transferId: string): Promise<void> {
    const transfer = await this.prisma.childTransfer.findUnique({
      where: { id: transferId },
      select: { id: true, fromCenterId: true, status: true },
    });
    if (!transfer || transfer.status !== TransferStatus.accepted) return;

    await this.notificationEvents.onTransferAccepted({
      transferId: transfer.id,
      fromCenterId: transfer.fromCenterId,
    });
  }

  async afterTransferCancelled(transferId: string): Promise<void> {
    const transfer = await this.prisma.childTransfer.findUnique({
      where: { id: transferId },
      select: { id: true, toCenterId: true, status: true },
    });
    if (!transfer || transfer.status !== TransferStatus.cancelled) return;

    await this.notificationEvents.onTransferCancelled({
      transferId: transfer.id,
      toCenterId: transfer.toCenterId,
    });
  }

  async afterReferralStatusUpdated(referralId: string, nextStatus: ReferralStatus): Promise<void> {
    const referral = await this.prisma.referral.findUnique({
      where: { id: referralId },
      select: { id: true, centerId: true, status: true },
    });
    if (!referral || referral.status !== nextStatus) return;

    await this.notificationEvents.onReferralStatusUpdated({
      referralId: referral.id,
      centerId: referral.centerId,
      status: referral.status,
    });
  }

  async afterChildArchived(childId: string): Promise<void> {
    const child = await this.prisma.child.findUnique({
      where: { id: childId },
      select: {
        id: true,
        centerId: true,
        firstName: true,
        lastName: true,
        status: true,
      },
    });
    if (!child || child.status !== ChildStatus.archived) return;

    await this.notificationEvents.onChildArchived({
      childId: child.id,
      centerId: child.centerId,
      firstName: child.firstName,
      lastName: child.lastName,
    });
  }

  async afterComplianceStatusChanged(
    assessmentId: string,
    previousStatus: AssessmentStatus,
  ): Promise<void> {
    const assessment = await this.prisma.complianceAssessment.findUnique({
      where: { id: assessmentId },
      select: {
        id: true,
        status: true,
        centerId: true,
        center: { select: { name: true, districtId: true } },
      },
    });
    if (!assessment) return;

    await this.notificationEvents.onComplianceAssessmentStatusChanged({
      assessmentId: assessment.id,
      centerId: assessment.centerId,
      centerName: assessment.center.name,
      districtId: assessment.center.districtId,
      previousStatus,
      newStatus: asDomainEnum<AssessmentStatus>(assessment.status),
    });
  }

  private async afterNutritionScreeningCreated(screeningId: string): Promise<void> {
    const screening = await this.prisma.childNutritionScreening.findUnique({
      where: { id: screeningId },
      select: {
        id: true,
        nutritionStatus: true,
        requiresReferral: true,
        child: {
          select: {
            centerId: true,
            center: { select: { districtId: true } },
          },
        },
      },
    });
    if (!screening) return;

    await this.notificationEvents.onNutritionScreeningCreated({
      screeningId: screening.id,
      nutritionStatus: asDomainEnum<NutritionStatus>(screening.nutritionStatus),
      requiresReferral: screening.requiresReferral,
      centerId: screening.child.centerId,
      districtId: screening.child.center.districtId,
    });
  }

  private async afterStedAssessmentCreated(assessmentId: string): Promise<void> {
    const assessment = await this.prisma.stedAssessment.findUnique({
      where: { id: assessmentId },
      select: {
        id: true,
        centerId: true,
        followUpIn6Months: true,
      },
    });
    if (!assessment) return;

    await this.notificationEvents.onStedAssessmentCreated({
      assessmentId: assessment.id,
      centerId: assessment.centerId,
      followUpIn6Months: assessment.followUpIn6Months,
    });
  }

  private async afterReferralCreated(referralId: string): Promise<void> {
    const referral = await this.prisma.referral.findUnique({
      where: { id: referralId },
      select: { id: true, centerId: true, sourceType: true },
    });
    if (!referral) return;

    await this.notificationEvents.onReferralCreated({
      referralId: referral.id,
      centerId: referral.centerId,
      sourceType: referral.sourceType,
    });
  }

  private async afterCenterCreated(centerId: string): Promise<void> {
    const center = await this.prisma.ecdCenter.findUnique({
      where: { id: centerId },
      select: {
        id: true,
        name: true,
        districtId: true,
        district: { select: { name: true } },
      },
    });
    if (!center) return;

    await this.notificationEvents.onCenterCreated({
      centerId: center.id,
      centerName: center.name,
      districtId: center.districtId,
      districtName: center.district?.name ?? null,
    });
  }

  private async afterChildCreated(childId: string): Promise<void> {
    const child = await this.prisma.child.findUnique({
      where: { id: childId },
      select: {
        id: true,
        centerId: true,
        firstName: true,
        lastName: true,
        status: true,
      },
    });
    if (!child || child.status !== ChildStatus.active) return;

    await this.notificationEvents.onChildEnrolled({
      childId: child.id,
      centerId: child.centerId,
      firstName: child.firstName,
      lastName: child.lastName,
    });
  }
}

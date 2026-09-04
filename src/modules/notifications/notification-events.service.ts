import { AssessmentStatus, NutritionStatus, UserRole } from '../../common/domain';
import { Injectable, Logger } from '@nestjs/common';
import { ReferralSourceType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationDedupeKeys } from './notification-dedupe';
import { NotificationsService } from './notifications.service';

@Injectable()
export class NotificationEventsService {
  private readonly logger = new Logger(NotificationEventsService.name);

  constructor(
    private readonly notifications: NotificationsService,
    private readonly prisma: PrismaService,
  ) {}

  async onNutritionScreeningCreated(input: {
    screeningId: string;
    nutritionStatus: NutritionStatus;
    requiresReferral: boolean;
    centerId: string;
    districtId: string | null;
  }): Promise<void> {
    const status = input.nutritionStatus;
    const isActionable =
      status === NutritionStatus.severe ||
      status === NutritionStatus.moderate ||
      status === NutritionStatus.at_risk ||
      input.requiresReferral;

    if (!isActionable) {
      return;
    }

    const statusLabel = status.replace('_', ' ');
    const referralSuffix = input.requiresReferral ? ' — referral required' : '';
    const notifData = {
      type: 'nutrition_alert' as const,
      title: `Nutrition screening: ${statusLabel}`,
      message: `A child has been screened with ${statusLabel} nutrition status${referralSuffix}.`,
      entityType: 'child_nutrition_screening',
      entityId: input.screeningId,
      dedupeKey: NotificationDedupeKeys.nutritionScreeningCreated(input.screeningId),
      metadata: {
        nutritionStatus: status,
        requiresReferral: input.requiresReferral,
      },
    };

    try {
      const [centerIds, districtIds] = await Promise.all([
        this.notifications.findUserIdsByRoleAndCenter(input.centerId, [UserRole.ecd_director]),
        input.districtId
          ? this.notifications.findUserIdsByRoleAndDistrict(input.districtId, [
              UserRole.district_focal_person,
            ])
          : Promise.resolve([]),
      ]);
      const allIds = [...new Set([...centerIds, ...districtIds])];
      this.notifications.notifyAsync(allIds, notifData, 'nutrition_screening_created');
    } catch (error) {
      this.logRecipientFailure('nutrition_screening_created', error);
    }
  }

  async onStedAssessmentCreated(input: {
    assessmentId: string;
    centerId: string;
    followUpIn6Months: boolean;
  }): Promise<void> {
    if (!input.followUpIn6Months) {
      return;
    }

    try {
      const userIds = await this.notifications.findUserIdsByRoleAndCenter(input.centerId, [
        UserRole.ecd_director,
        UserRole.caregiver,
      ]);
      this.notifications.notifyAsync(
        userIds,
        {
          type: 'sted_followup',
          title: 'STED follow-up scheduled',
          message: 'A STED assessment requires a 6-month follow-up.',
          entityType: 'sted_assessment',
          entityId: input.assessmentId,
          dedupeKey: NotificationDedupeKeys.stedFollowUpCreated(input.assessmentId),
        },
        'sted_assessment_created',
      );
    } catch (error) {
      this.logRecipientFailure('sted_assessment_created', error);
    }
  }

  async onReferralCreated(input: {
    referralId: string;
    centerId: string;
    sourceType: ReferralSourceType | string;
  }): Promise<void> {
    try {
      const userIds = await this.notifications.findUserIdsByRoleAndCenter(input.centerId, [
        UserRole.ecd_director,
      ]);
      this.notifications.notifyAsync(
        userIds,
        {
          type: 'referral_created',
          title: 'New referral created',
          message: `A new ${input.sourceType} referral has been created.`,
          entityType: 'referral',
          entityId: input.referralId,
          dedupeKey: NotificationDedupeKeys.referralCreated(input.referralId),
        },
        'referral_created',
      );
    } catch (error) {
      this.logRecipientFailure('referral_created', error);
    }
  }

  async onReferralStatusUpdated(input: {
    referralId: string;
    centerId: string;
    status: string;
  }): Promise<void> {
    try {
      const userIds = await this.notifications.findUserIdsByRoleAndCenter(input.centerId, [
        UserRole.ecd_director,
        UserRole.caregiver,
      ]);
      this.notifications.notifyAsync(
        userIds,
        {
          type: 'referral_updated',
          title: 'Referral status updated',
          message: `A referral has been updated to ${input.status}.`,
          entityType: 'referral',
          entityId: input.referralId,
          dedupeKey: NotificationDedupeKeys.referralStatusUpdated(input.referralId, input.status),
        },
        'referral_status_updated',
      );
    } catch (error) {
      this.logRecipientFailure('referral_status_updated', error);
    }
  }

  async onCenterCreated(input: {
    centerId: string;
    centerName: string;
    districtId: string;
    districtName?: string | null;
  }): Promise<void> {
    const districtSuffix = input.districtName ? ` in ${input.districtName}` : '';
    const notifData = {
      type: 'center_created' as const,
      title: 'New ECD center registered',
      message: `${input.centerName} has been registered${districtSuffix}.`,
      entityType: 'ecd_center',
      entityId: input.centerId,
      dedupeKey: NotificationDedupeKeys.centerCreated(input.centerId),
    };

    try {
      const [adminIds, districtIds] = await Promise.all([
        this.notifications.findUserIdsByRole([UserRole.ncda_admin]),
        this.notifications.findUserIdsByRoleAndDistrict(input.districtId, [
          UserRole.district_focal_person,
        ]),
      ]);
      const allIds = [...new Set([...adminIds, ...districtIds])];
      this.notifications.notifyAsync(allIds, notifData, 'center_created');
    } catch (error) {
      this.logRecipientFailure('center_created', error);
    }
  }

  async onChildEnrolled(input: {
    childId: string;
    centerId: string;
    firstName: string;
    lastName: string | null;
  }): Promise<void> {
    try {
      const userIds = await this.notifications.findUserIdsByRoleAndCenter(input.centerId, [
        UserRole.ecd_director,
      ]);
      this.notifications.notifyAsync(
        userIds,
        {
          type: 'child_enrolled',
          title: 'New child enrolled',
          message: `${input.firstName} ${input.lastName ?? ''} has been enrolled.`.trim(),
          entityType: 'child',
          entityId: input.childId,
          dedupeKey: NotificationDedupeKeys.childEnrolled(input.childId),
        },
        'child_enrolled',
      );
    } catch (error) {
      this.logRecipientFailure('child_enrolled', error);
    }
  }

  async onChildArchived(input: {
    childId: string;
    centerId: string;
    firstName: string;
    lastName: string | null;
  }): Promise<void> {
    try {
      const userIds = await this.notifications.findUserIdsByRoleAndCenter(input.centerId, [
        UserRole.caregiver,
      ]);
      this.notifications.notifyAsync(
        userIds,
        {
          type: 'child_archived',
          title: 'Child archived',
          message: `${input.firstName} ${input.lastName ?? ''} has been archived.`.trim(),
          entityType: 'child',
          entityId: input.childId,
          dedupeKey: NotificationDedupeKeys.childArchived(input.childId),
        },
        'child_archived',
      );
    } catch (error) {
      this.logRecipientFailure('child_archived', error);
    }
  }

  async onTransferRequested(input: {
    transferId: string;
    toCenterId: string;
    childFirstName: string | null;
  }): Promise<void> {
    await this.notifyTransferCenter(
      'transfer_request',
      input.toCenterId,
      `Transfer request for ${input.childFirstName ?? 'child'}`,
      'A child transfer has been requested to your center.',
      input.transferId,
      [UserRole.ecd_director],
      'transfer_requested',
      NotificationDedupeKeys.transferRequested(input.transferId),
    );
  }

  async onTransferAccepted(input: { transferId: string; fromCenterId: string }): Promise<void> {
    await this.notifyTransferCenter(
      'transfer_accepted',
      input.fromCenterId,
      'Transfer accepted',
      'Your child transfer request has been accepted by the destination center.',
      input.transferId,
      [UserRole.ecd_director, UserRole.caregiver],
      'transfer_accepted',
      NotificationDedupeKeys.transferAccepted(input.transferId),
    );
  }

  async onTransferCancelled(input: { transferId: string; toCenterId: string }): Promise<void> {
    await this.notifyTransferCenter(
      'transfer_cancelled',
      input.toCenterId,
      'Transfer cancelled',
      'A child transfer to your center has been cancelled.',
      input.transferId,
      [UserRole.ecd_director],
      'transfer_cancelled',
      NotificationDedupeKeys.transferCancelled(input.transferId),
    );
  }

  async onComplianceAssessmentStatusChanged(input: {
    assessmentId: string;
    centerId: string;
    centerName: string;
    districtId: string;
    previousStatus: AssessmentStatus;
    newStatus: AssessmentStatus;
  }): Promise<void> {
    if (input.previousStatus === input.newStatus) {
      return;
    }

    if (input.newStatus === AssessmentStatus.submitted) {
      try {
        const userIds = await this.notifications.findUserIdsByRoleAndDistrict(input.districtId, [
          UserRole.district_focal_person,
        ]);
        this.notifications.notifyAsync(
          userIds,
          {
            type: 'compliance_update',
            title: 'Compliance assessment submitted',
            message: `A compliance assessment for ${input.centerName} has been submitted for review.`,
            entityType: 'compliance_assessment',
            entityId: input.assessmentId,
            dedupeKey: NotificationDedupeKeys.complianceStatusChanged(
              input.assessmentId,
              AssessmentStatus.submitted,
            ),
          },
          'compliance_submitted',
        );
      } catch (error) {
        this.logRecipientFailure('compliance_submitted', error);
      }
      return;
    }

    if (
      input.newStatus === AssessmentStatus.verified ||
      input.newStatus === AssessmentStatus.rejected
    ) {
      try {
        const userIds = await this.notifications.findUserIdsByRoleAndCenter(input.centerId, [
          UserRole.ecd_director,
        ]);
        this.notifications.notifyAsync(
          userIds,
          {
            type: 'compliance_update',
            title: `Compliance assessment ${input.newStatus}`,
            message: `Your compliance assessment has been ${input.newStatus}.`,
            entityType: 'compliance_assessment',
            entityId: input.assessmentId,
            dedupeKey: NotificationDedupeKeys.complianceStatusChanged(
              input.assessmentId,
              input.newStatus,
            ),
          },
          `compliance_${input.newStatus}`,
        );
      } catch (error) {
        this.logRecipientFailure(`compliance_${input.newStatus}`, error);
      }
    }
  }

  private async notifyTransferCenter(
    type: 'transfer_request' | 'transfer_accepted' | 'transfer_cancelled',
    centerId: string,
    title: string,
    message: string,
    transferId: string,
    roles: UserRole[],
    logContext: string,
    dedupeKey: string,
  ): Promise<void> {
    try {
      const userIds = await this.notifications.findUserIdsByRoleAndCenter(centerId, roles);
      this.notifications.notifyAsync(
        userIds,
        {
          type,
          title,
          message,
          entityType: 'child_transfer',
          entityId: transferId,
          dedupeKey,
        },
        logContext,
      );
    } catch (error) {
      this.logRecipientFailure(logContext, error);
    }
  }

  private logRecipientFailure(context: string, error: unknown): void {
    this.logger.error(
      `Failed to resolve recipients for ${context}: ${
        error instanceof Error ? error.message : String(error)
      }`,
      error instanceof Error ? error.stack : undefined,
    );
  }
}

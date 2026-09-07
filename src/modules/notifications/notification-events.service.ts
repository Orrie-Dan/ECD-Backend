import { AssessmentStatus, NutritionStatus, UserRole } from '../../common/domain';
import { Injectable, Logger } from '@nestjs/common';
import { ReferralSourceType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationCopy } from './notification-copy';
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

    const copy = NotificationCopy.nutritionAlert(status, input.requiresReferral);
    const notifData = {
      type: 'nutrition_alert' as const,
      title: copy.title,
      message: copy.message,
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
          ...NotificationCopy.stedFollowUpCreated,
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
      const copy = NotificationCopy.referralCreated(String(input.sourceType));
      this.notifications.notifyAsync(
        userIds,
        {
          type: 'referral_created',
          title: copy.title,
          message: copy.message,
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
      const copy = NotificationCopy.referralUpdated(input.status);
      this.notifications.notifyAsync(
        userIds,
        {
          type: 'referral_updated',
          title: copy.title,
          message: copy.message,
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
    const copy = NotificationCopy.centerCreated(input.centerName, input.districtName);
    const notifData = {
      type: 'center_created' as const,
      title: copy.title,
      message: copy.message,
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
      const copy = NotificationCopy.childEnrolled(input.firstName, input.lastName);
      this.notifications.notifyAsync(
        userIds,
        {
          type: 'child_enrolled',
          title: copy.title,
          message: copy.message,
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
      const copy = NotificationCopy.childArchived(input.firstName, input.lastName);
      this.notifications.notifyAsync(
        userIds,
        {
          type: 'child_archived',
          title: copy.title,
          message: copy.message,
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
    const copy = NotificationCopy.transferRequested(input.childFirstName);
    await this.notifyTransferCenter(
      'transfer_request',
      input.toCenterId,
      copy.title,
      copy.message,
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
      NotificationCopy.transferAccepted.title,
      NotificationCopy.transferAccepted.message,
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
      NotificationCopy.transferCancelled.title,
      NotificationCopy.transferCancelled.message,
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
        const copy = NotificationCopy.complianceSubmitted(input.centerName);
        this.notifications.notifyAsync(
          userIds,
          {
            type: 'compliance_update',
            title: copy.title,
            message: copy.message,
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
        const copy = NotificationCopy.complianceVerifiedOrRejected(input.newStatus);
        this.notifications.notifyAsync(
          userIds,
          {
            type: 'compliance_update',
            title: copy.title,
            message: copy.message,
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

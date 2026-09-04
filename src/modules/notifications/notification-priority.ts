import { NutritionStatus } from '../../common/domain';
import { NotificationType } from '@prisma/client';
export const NOTIFICATION_PRIORITIES = ['low', 'medium', 'high', 'critical'] as const;
export type NotificationPriority = (typeof NOTIFICATION_PRIORITIES)[number];

type PriorityInput = {
  type: string;
  entityType?: string | null;
  nutritionStatus?: string | null;
  metadataPriority?: string | null;
};

/**
 * Deterministic inbox priority. Not persisted — derived at read time
 * from notification type, related entity type, and optional domain status.
 */
export function resolveNotificationPriority(input: PriorityInput): NotificationPriority {
  if (input.type === NotificationType.nutrition_alert) {
    if (input.nutritionStatus === NutritionStatus.severe) {
      return 'critical';
    }
    if (input.nutritionStatus === NutritionStatus.at_risk) {
      return 'medium';
    }
    return 'high';
  }

  if (input.type === NotificationType.attendance_low_rate) {
    if (input.metadataPriority === 'high' || input.metadataPriority === 'critical') {
      return input.metadataPriority;
    }
    return 'medium';
  }

  if (input.type === NotificationType.referral_updated) {
    if (input.metadataPriority === 'high' || input.metadataPriority === 'critical') {
      return input.metadataPriority;
    }
    return 'medium';
  }

  if (
    input.type === NotificationType.compliance_update &&
    input.entityType === 'compliance_assessment_item'
  ) {
    return 'high';
  }

  switch (input.type) {
    case NotificationType.referral_created:
    case NotificationType.transfer_request:
    case NotificationType.attendance_absence:
      return 'high';
    case NotificationType.referral_updated:
    case NotificationType.transfer_accepted:
    case NotificationType.sted_followup:
    case NotificationType.compliance_update:
    case NotificationType.capacity_warning:
    case NotificationType.center_created:
      return 'medium';
    case NotificationType.transfer_cancelled:
    case NotificationType.child_enrolled:
    case NotificationType.child_archived:
    case NotificationType.general:
      return 'low';
    default:
      return 'medium';
  }
}

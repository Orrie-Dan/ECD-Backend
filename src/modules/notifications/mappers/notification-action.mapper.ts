import { UserRole } from '../../../common/domain';
import { NotificationType } from '@prisma/client';
import { NotificationActionDto } from '../dto/notification-response.dto';

export type NotificationActionInput = {
  type: string;
  entityType?: string | null;
  entityId?: string | null;
  childId?: string | null;
  centerId?: string | null;
  /** Compliance assessment id when the stored entity is an assessment item. */
  assessmentId?: string | null;
  role?: UserRole;
};

const CHILD_ROLES: UserRole[] = [
  UserRole.caregiver,
  UserRole.ecd_director,
  UserRole.district_focal_person,
  UserRole.ncda_admin,
];

const TRANSFER_DETAIL_ROLES: UserRole[] = [UserRole.ecd_director];

const USER_ROLES: UserRole[] = [
  UserRole.ecd_director,
  UserRole.district_focal_person,
  UserRole.ncda_admin,
];

function route(path: string): NotificationActionDto {
  return { type: 'route', path };
}

function canAccess(role: UserRole | undefined, allowed: UserRole[]): boolean {
  if (!role) {
    return true;
  }
  return allowed.includes(role);
}

/**
 * Frontend SPA paths from `docs/frontend-notifications-alerts.md`.
 * Role checks follow backend controller @Roles so we do not advertise
 * routes the authenticated role cannot call.
 */
export function mapNotificationAction(
  input: NotificationActionInput,
): NotificationActionDto | null {
  const { type, entityType, entityId, childId, centerId, assessmentId, role } = input;

  if (type === NotificationType.nutrition_alert || type === NotificationType.sted_followup) {
    if (childId && canAccess(role, CHILD_ROLES)) {
      return route(`/children/${childId}`);
    }
    return null;
  }

  if (type === NotificationType.referral_created || type === NotificationType.referral_updated) {
    if (entityId) {
      return route(`/referrals/${entityId}`);
    }
    return null;
  }

  if (
    type === NotificationType.transfer_request ||
    type === NotificationType.transfer_accepted ||
    type === NotificationType.transfer_cancelled
  ) {
    if (entityId && canAccess(role, TRANSFER_DETAIL_ROLES)) {
      return route(`/transfers/${entityId}`);
    }
    if (childId && canAccess(role, CHILD_ROLES)) {
      return route(`/children/${childId}`);
    }
    return null;
  }

  if (
    type === NotificationType.child_enrolled ||
    type === NotificationType.child_archived ||
    type === NotificationType.attendance_absence
  ) {
    const id = childId ?? (entityType === 'child' ? entityId : null);
    if (id && canAccess(role, CHILD_ROLES)) {
      return route(`/children/${id}`);
    }
    return null;
  }

  if (type === NotificationType.compliance_update) {
    const id = assessmentId ?? (entityType === 'compliance_assessment' ? entityId : null);
    if (id) {
      return route(`/compliance/${id}`);
    }
    if (centerId) {
      return route(`/centers/${centerId}`);
    }
    return null;
  }

  if (
    type === NotificationType.capacity_warning ||
    type === NotificationType.attendance_low_rate ||
    type === NotificationType.center_created
  ) {
    const id = centerId ?? (entityType === 'ecd_center' ? entityId : null);
    if (id) {
      return route(`/centers/${id}`);
    }
    return null;
  }

  if (type === NotificationType.general && entityType === 'user_account') {
    if (entityId && canAccess(role, USER_ROLES)) {
      return route(`/users/${entityId}`);
    }
    return null;
  }

  if (entityType === 'child' && entityId && canAccess(role, CHILD_ROLES)) {
    return route(`/children/${entityId}`);
  }

  return null;
}

/**
 * Central dedupe-key generation for notification producers.
 * Keys identify logical notification events — not title/message text.
 * Uniqueness is enforced at DB level on (userId, dedupeKey).
 */

export type NotificationDedupeInput = {
  type: string;
  event: string;
  entityType?: string;
  entityId?: string;
  period?: string;
};

/** Build a deterministic dedupe key from structured notification identity fields. */
export function buildNotificationDedupeKey(input: NotificationDedupeInput): string {
  const parts: string[] = [input.type, input.event];
  if (input.entityType && input.entityId) {
    parts.push(input.entityType, input.entityId);
  } else if (input.entityId) {
    parts.push(input.entityId);
  }
  if (input.period) {
    parts.push(input.period);
  }
  return parts.join(':');
}

/** Attendance lookback window end date (YYYY-MM-DD) — one notification per window per entity. */
export function attendanceWindowPeriod(windowEnd: Date): string {
  return windowEnd.toISOString().slice(0, 10);
}

export const NotificationDedupeKeys = {
  nutritionScreeningCreated: (screeningId: string) =>
    buildNotificationDedupeKey({
      type: 'nutrition_alert',
      event: 'created',
      entityType: 'child_nutrition_screening',
      entityId: screeningId,
    }),

  stedFollowUpCreated: (assessmentId: string) =>
    buildNotificationDedupeKey({
      type: 'sted_followup',
      event: 'created',
      entityType: 'sted_assessment',
      entityId: assessmentId,
    }),

  stedFollowUpCronUpcoming: (assessmentId: string) =>
    buildNotificationDedupeKey({
      type: 'sted_followup',
      event: 'cron_upcoming',
      entityType: 'sted_assessment',
      entityId: assessmentId,
    }),

  referralCreated: (referralId: string) =>
    buildNotificationDedupeKey({
      type: 'referral_created',
      event: 'created',
      entityType: 'referral',
      entityId: referralId,
    }),

  referralStatusUpdated: (referralId: string, status: string) =>
    buildNotificationDedupeKey({
      type: 'referral_updated',
      event: 'status',
      entityType: 'referral',
      entityId: referralId,
      period: status,
    }),

  childEnrolled: (childId: string) =>
    buildNotificationDedupeKey({
      type: 'child_enrolled',
      event: 'created',
      entityType: 'child',
      entityId: childId,
    }),

  childArchived: (childId: string) =>
    buildNotificationDedupeKey({
      type: 'child_archived',
      event: 'archived',
      entityType: 'child',
      entityId: childId,
    }),

  transferRequested: (transferId: string) =>
    buildNotificationDedupeKey({
      type: 'transfer_request',
      event: 'created',
      entityType: 'child_transfer',
      entityId: transferId,
    }),

  transferAccepted: (transferId: string) =>
    buildNotificationDedupeKey({
      type: 'transfer_accepted',
      event: 'accepted',
      entityType: 'child_transfer',
      entityId: transferId,
    }),

  transferCancelled: (transferId: string) =>
    buildNotificationDedupeKey({
      type: 'transfer_cancelled',
      event: 'cancelled',
      entityType: 'child_transfer',
      entityId: transferId,
    }),

  transferCronStale: (transferId: string) =>
    buildNotificationDedupeKey({
      type: 'transfer_request',
      event: 'cron_stale',
      entityType: 'child_transfer',
      entityId: transferId,
    }),

  complianceStatusChanged: (assessmentId: string, status: string) =>
    buildNotificationDedupeKey({
      type: 'compliance_update',
      event: 'status',
      entityType: 'compliance_assessment',
      entityId: assessmentId,
      period: status,
    }),

  complianceGapCronOverdue: (itemId: string) =>
    buildNotificationDedupeKey({
      type: 'compliance_update',
      event: 'cron_gap_overdue',
      entityType: 'compliance_assessment_item',
      entityId: itemId,
    }),

  capacityCronAtCapacity: (centerId: string) =>
    buildNotificationDedupeKey({
      type: 'capacity_warning',
      event: 'cron_at_capacity',
      entityType: 'ecd_center',
      entityId: centerId,
    }),

  attendanceAbsenceCron: (childId: string, windowEnd: Date) =>
    buildNotificationDedupeKey({
      type: 'attendance_absence',
      event: 'cron',
      entityType: 'child',
      entityId: childId,
      period: attendanceWindowPeriod(windowEnd),
    }),

  attendanceLowRateCron: (centerId: string, windowEnd: Date) =>
    buildNotificationDedupeKey({
      type: 'attendance_low_rate',
      event: 'cron',
      entityType: 'ecd_center',
      entityId: centerId,
      period: attendanceWindowPeriod(windowEnd),
    }),

  userProvisioned: (newUserId: string) =>
    buildNotificationDedupeKey({
      type: 'general',
      event: 'user_provisioned',
      entityType: 'user_account',
      entityId: newUserId,
    }),

  centerCreated: (centerId: string) =>
    buildNotificationDedupeKey({
      type: 'center_created',
      event: 'created',
      entityType: 'ecd_center',
      entityId: centerId,
    }),

  /**
   * Stale referral cron — one notification per referral lifecycle.
   * Key is stable across daily runs so repeated cron executions do not duplicate.
   * A resolved-then-reopened referral would produce a new referral record,
   * so the same referralId will not generate a second stale notification.
   */
  referralCronStale: (referralId: string) =>
    buildNotificationDedupeKey({
      type: 'referral_updated',
      event: 'cron_stale',
      entityType: 'referral',
      entityId: referralId,
    }),

  /**
   * Overdue nutrition screening cron — one notification per child per overdue lifecycle.
   * Uses childId (not screeningId) because the condition is "child has not been screened recently".
   * A new screening resets the overdue clock; if the child becomes overdue again later,
   * the new latest screeningDate in the period segment produces a fresh key.
   */
  nutritionOverdueCron: (childId: string, lastScreeningDate: string) =>
    buildNotificationDedupeKey({
      type: 'nutrition_alert',
      event: 'cron_overdue',
      entityType: 'child',
      entityId: childId,
      period: lastScreeningDate,
    }),

  /**
   * Never-screened nutrition cron — one notification per child lifetime (no screening exists).
   * If the child later gets screened and then becomes overdue, nutritionOverdueCron handles that.
   */
  nutritionNeverScreenedCron: (childId: string) =>
    buildNotificationDedupeKey({
      type: 'nutrition_alert',
      event: 'cron_never_screened',
      entityType: 'child',
      entityId: childId,
    }),
} as const;

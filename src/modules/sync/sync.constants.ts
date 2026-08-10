export const SYNC_QUEUE = 'sync-operations';

export const SYNCABLE_ENTITY_TYPES = [
  'child',
  'attendance_record',
  'child_nutrition_screening',
  'child_transfer',
  'ecd_center',
  'compliance_assessment',
  'compliance_assessment_item',
  'wash_indicator',
  'center_feeding_day',
  'center_feeding_month_summary',
  'sted_assessment',
  'referral',
] as const;

export type SyncableEntityType = (typeof SYNCABLE_ENTITY_TYPES)[number];

/** Default / max page size for sync pull (keyset pagination). */
export const SYNC_PULL_DEFAULT_LIMIT = 500;
export const SYNC_PULL_MAX_LIMIT = 1000;

/** Pending session older than this is eligible for recovery requeue. */
export const SYNC_STALE_THRESHOLD_MS = 5 * 60 * 1000;

/** Max recovery requeues per session before marking remaining ops failed. */
export const SYNC_MAX_RECOVERY_RETRIES = 5;

/** How often the recovery sweep runs. */
export const SYNC_RECOVERY_INTERVAL_MS = 60 * 1000;

export const SYNC_JOB_PROCESS_SESSION = 'process-session';
export const SYNC_JOB_RECOVER_STALE = 'recover-stale';

export interface SyncJobPayload {
  sessionId: string;
}

export interface SyncPullCursor {
  lastModifiedAt: string;
  id: string;
}

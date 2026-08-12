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

/**
 * Max recovery requeues at the 5-minute stale cadence.
 * After this, ops stay pending and are retried on SYNC_PARKED_RETRY_MS.
 * Never convert caregiver data to unrecoverable `failed` for infrastructure.
 */
export const SYNC_MAX_RECOVERY_RETRIES = 5;

/** How often the recovery sweep runs. */
export const SYNC_RECOVERY_INTERVAL_MS = 60 * 1000;

/**
 * After SYNC_MAX_RECOVERY_RETRIES, requeue parked sessions on this interval.
 * Bounded: one job per parked session per 15 minutes, retryCount not incremented.
 */
export const SYNC_PARKED_RETRY_MS = 15 * 60 * 1000;

/**
 * Worker lock must outlive a 500-op apply batch.
 * Default BullMQ lockDuration is 30s — a slow batch is then marked stalled
 * while still running. 120s is below the 5-minute stale recovery so a truly
 * dead worker is still recovered. stalledInterval stays 30s to detect death
 * without treating a live lock as stalled.
 */
export const SYNC_WORKER_CONCURRENCY = 1;
export const SYNC_WORKER_LOCK_DURATION_MS = 120_000;
export const SYNC_WORKER_STALLED_INTERVAL_MS = 30_000;
export const SYNC_WORKER_MAX_STALLED_COUNT = 2;

/** Child-scoped creates that must not apply before the parent child row exists. */
export const CHILD_SCOPED_ENTITY_TYPES = [
  'attendance_record',
  'child_nutrition_screening',
  'sted_assessment',
  'referral',
] as const;

export const SYNC_JOB_PROCESS_SESSION = 'process-session';
export const SYNC_JOB_RECOVER_STALE = 'recover-stale';

export interface SyncJobPayload {
  sessionId: string;
}

export interface SyncPullCursor {
  lastModifiedAt: string;
  id: string;
}

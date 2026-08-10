import { Prisma } from '@prisma/client';
import { AuditAction } from './audit-action';

export type AuditActorType = 'user' | 'device' | 'system';

/**
 * Input for AuditService.log().
 * Always pass `tx` when writing inside a business mutation transaction.
 */
export type AuditContext = {
  /** Interactive transaction client — required for atomic audit writes. */
  tx: Prisma.TransactionClient;
  entityType: string;
  entityId: string;
  action: AuditAction;
  /** Full entity snapshot before mutation (Option A). Null for creates. */
  oldValues?: unknown | null;
  /** Full entity snapshot after mutation (Option A). */
  newValues?: unknown | null;
  /** Authenticated user (REST / sync device owner). Null for pure system jobs. */
  userId?: string | null;
  /** Offline device id when the mutation originated from a device. */
  deviceId?: string | null;
  /** Sync clientOperationId or sync_operation.id for offline attribution. */
  operationId?: string | null;
  /** Explicit actor kind; inferred when omitted. */
  actorType?: AuditActorType;
  /** Extra reporting fields (reason, source, etc.). */
  metadata?: Record<string, unknown> | null;
  /** Override changedAt (defaults to now). */
  changedAt?: Date;
};

export type AuditMetadata = {
  domainAction: AuditAction;
  actorType: AuditActorType;
  deviceId?: string;
  operationId?: string;
  [key: string]: unknown;
};

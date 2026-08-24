import { AuditAction as PrismaAuditAction } from '@prisma/client';

/**
 * Domain audit actions (application layer).
 * Stored as metadata.domainAction; mapped to Prisma create/update/delete
 * so sync_operation can keep sharing the narrow audit_action enum.
 */
export enum AuditAction {
  CREATE = 'CREATE',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE',
  ARCHIVE = 'ARCHIVE',
  RESTORE = 'RESTORE',
  TRANSFER_REQUEST = 'TRANSFER_REQUEST',
  TRANSFER_ACCEPT = 'TRANSFER_ACCEPT',
  TRANSFER_CANCEL = 'TRANSFER_CANCEL',
  STATUS_CHANGE = 'STATUS_CHANGE',
}

/** Map domain action → Prisma audit_action (shared with sync_operation). */
export function toPrismaAuditAction(action: AuditAction): PrismaAuditAction {
  switch (action) {
    case AuditAction.CREATE:
    case AuditAction.TRANSFER_REQUEST:
      return PrismaAuditAction.create;
    case AuditAction.DELETE:
      return PrismaAuditAction.delete;
    case AuditAction.UPDATE:
    case AuditAction.ARCHIVE:
    case AuditAction.RESTORE:
    case AuditAction.TRANSFER_ACCEPT:
    case AuditAction.TRANSFER_CANCEL:
    case AuditAction.STATUS_CHANGE:
      return PrismaAuditAction.update;
    default:
      return PrismaAuditAction.update;
  }
}

/** Map a sync Prisma operation to a domain audit action. */
export function fromPrismaAuditAction(operation: PrismaAuditAction): AuditAction {
  switch (operation) {
    case PrismaAuditAction.create:
      return AuditAction.CREATE;
    case PrismaAuditAction.delete:
      return AuditAction.DELETE;
    case PrismaAuditAction.update:
    default:
      return AuditAction.UPDATE;
  }
}

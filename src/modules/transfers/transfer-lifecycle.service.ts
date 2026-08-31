import { Injectable } from '@nestjs/common';
import {
  Child,
  ChildStatus,
  ChildTransfer,
  Prisma,
  RecordSyncStatus,
  TransferStatus,
} from '@prisma/client';
import { AuditAction, AuditService, toAuditJson } from '../../common/audit';
import { LookupDualWrite, LookupResolverService } from '../../common/lookups';
import { OptimisticLockConflictException } from '../../common/concurrency/optimistic-lock.exception';

export type TransferLifecycleResult =
  | { status: 'applied'; transfer: ChildTransfer; child: Child }
  | { status: 'conflict'; conflictReason: string };

export type CreatePendingTransferInput = {
  transferId: string;
  childId: string;
  fromCenterId: string;
  toCenterId: string;
  transferDate: Date;
  reason: string;
  notes?: string | null;
  initiatedById: string;
  deviceId: string | null;
  childVersion: number;
  updatedById?: string | null;
  operationId?: string | null;
  transferMeta?: {
    version: number;
    syncStatus: RecordSyncStatus;
    lastModifiedByDeviceId: string | null;
    lastModifiedAt: Date;
  };
};

export type AcceptTransferInput = {
  transferId: string;
  acceptedById: string;
  deviceId: string | null;
  transferVersion: number;
  childVersion: number;
  updatedById?: string | null;
  operationId?: string | null;
};

export type CancelTransferInput = {
  transferId: string;
  deviceId: string | null;
  transferVersion: number;
  childVersion: number;
  updatedById?: string | null;
  operationId?: string | null;
};

/**
 * Shared transfer lifecycle for REST and offline sync.
 * pending → accepted | cancelled. Create does not move child.centerId.
 * Audit records are written in the same transaction as the mutation.
 */
@Injectable()
export class TransferLifecycleService {
  private readonly lookupDw: LookupDualWrite;

  constructor(
    private readonly audit: AuditService,
    lookupResolver: LookupResolverService,
  ) {
    this.lookupDw = new LookupDualWrite(lookupResolver);
  }

  async createPending(
    tx: Prisma.TransactionClient,
    input: CreatePendingTransferInput,
  ): Promise<TransferLifecycleResult> {
    const now = new Date();

    if (input.fromCenterId === input.toCenterId) {
      return {
        status: 'conflict',
        conflictReason: 'Child is already assigned to this center',
      };
    }

    const pendingExisting = await tx.childTransfer.findFirst({
      where: {
        childId: input.childId,
        status: TransferStatus.pending,
        deletedAt: null,
      },
      select: { id: true },
    });

    if (pendingExisting) {
      return {
        status: 'conflict',
        conflictReason: 'Child already has a pending transfer',
      };
    }

    const childBefore = await tx.child.findUnique({
      where: { id: input.childId },
    });

    const childUpdate = await tx.child.updateMany({
      where: {
        id: input.childId,
        version: input.childVersion,
        centerId: input.fromCenterId,
        deletedAt: null,
        status: { not: ChildStatus.archived },
      },
      data: {
        ...this.lookupDw.childStatus(ChildStatus.transferred),
        updatedAt: now,
        ...(input.updatedById != null ? { updatedById: input.updatedById } : {}),
        version: { increment: 1 },
        syncStatus: RecordSyncStatus.synced,
        lastModifiedByDeviceId: input.deviceId,
        lastModifiedAt: now,
      },
    });

    if (childUpdate.count === 0) {
      return this.childConflict(tx, input.childId, input.fromCenterId, input.childVersion);
    }

    const transferMeta = input.transferMeta ?? {
      version: 1,
      syncStatus: RecordSyncStatus.synced,
      lastModifiedByDeviceId: input.deviceId,
      lastModifiedAt: now,
    };

    const transfer = await tx.childTransfer.create({
      data: {
        id: input.transferId,
        childId: input.childId,
        fromCenterId: input.fromCenterId,
        toCenterId: input.toCenterId,
        transferDate: input.transferDate,
        reason: input.reason,
        notes: input.notes ?? null,
        ...this.lookupDw.transferStatus(TransferStatus.pending),
        initiatedById: input.initiatedById,
        ...transferMeta,
      },
    });

    const child = await tx.child.findUniqueOrThrow({
      where: { id: input.childId },
    });

    await this.audit.log({
      tx,
      entityType: 'child_transfer',
      entityId: transfer.id,
      action: AuditAction.TRANSFER_REQUEST,
      userId: input.initiatedById,
      deviceId: input.deviceId,
      operationId: input.operationId,
      oldValues: null,
      newValues: toAuditJson(transfer),
      changedAt: now,
      metadata: {
        childId: child.id,
        fromCenterId: input.fromCenterId,
        toCenterId: input.toCenterId,
      },
    });

    await this.audit.log({
      tx,
      entityType: 'child',
      entityId: child.id,
      action: AuditAction.STATUS_CHANGE,
      userId: input.updatedById ?? input.initiatedById,
      deviceId: input.deviceId,
      operationId: input.operationId,
      oldValues: childBefore
        ? toAuditJson({
            centerId: childBefore.centerId,
            status: childBefore.status,
            version: childBefore.version,
          })
        : null,
      newValues: toAuditJson({
        centerId: child.centerId,
        status: child.status,
        version: child.version,
      }),
      changedAt: now,
      metadata: {
        transferId: transfer.id,
        reason: 'transfer_request',
      },
    });

    return { status: 'applied', transfer, child };
  }

  async accept(
    tx: Prisma.TransactionClient,
    input: AcceptTransferInput,
  ): Promise<TransferLifecycleResult> {
    const now = new Date();

    const existing = await tx.childTransfer.findFirst({
      where: { id: input.transferId, deletedAt: null },
    });

    if (!existing) {
      return { status: 'conflict', conflictReason: 'Transfer not found' };
    }

    if (existing.status !== TransferStatus.pending) {
      return {
        status: 'conflict',
        conflictReason: `Cannot accept transfer in status ${existing.status}`,
      };
    }

    if (existing.version !== input.transferVersion) {
      return {
        status: 'conflict',
        conflictReason: `Transfer version mismatch: client ${input.transferVersion}, server ${existing.version}`,
      };
    }

    const childBefore = await tx.child.findUnique({
      where: { id: existing.childId },
    });

    const transferUpdate = await tx.childTransfer.updateMany({
      where: {
        id: input.transferId,
        status: TransferStatus.pending,
        version: input.transferVersion,
        deletedAt: null,
      },
      data: {
        ...this.lookupDw.transferStatus(TransferStatus.accepted),
        acceptedAt: now,
        acceptedById: input.acceptedById,
        updatedAt: now,
        version: { increment: 1 },
        syncStatus: RecordSyncStatus.synced,
        lastModifiedByDeviceId: input.deviceId,
        lastModifiedAt: now,
      },
    });

    if (transferUpdate.count === 0) {
      return {
        status: 'conflict',
        conflictReason: 'Transfer could not be accepted (concurrent update)',
      };
    }

    const childUpdate = await tx.child.updateMany({
      where: {
        id: existing.childId,
        version: input.childVersion,
        deletedAt: null,
      },
      data: {
        centerId: existing.toCenterId,
        ...this.lookupDw.childStatus(ChildStatus.active),
        updatedAt: now,
        ...(input.updatedById != null ? { updatedById: input.updatedById } : {}),
        version: { increment: 1 },
        syncStatus: RecordSyncStatus.synced,
        lastModifiedByDeviceId: input.deviceId,
        lastModifiedAt: now,
      },
    });

    if (childUpdate.count === 0) {
      // Ensure the transaction rolls back the transfer status change and surface a clean 409.
      throw new OptimisticLockConflictException('child_transfer', childBefore?.version);
    }

    const transfer = await tx.childTransfer.findUniqueOrThrow({
      where: { id: input.transferId },
    });
    const child = await tx.child.findUniqueOrThrow({
      where: { id: existing.childId },
    });

    await this.audit.log({
      tx,
      entityType: 'child_transfer',
      entityId: transfer.id,
      action: AuditAction.TRANSFER_ACCEPT,
      userId: input.acceptedById,
      deviceId: input.deviceId,
      operationId: input.operationId,
      oldValues: toAuditJson(existing),
      newValues: toAuditJson(transfer),
      changedAt: now,
    });

    await this.audit.log({
      tx,
      entityType: 'child',
      entityId: child.id,
      action: AuditAction.TRANSFER_ACCEPT,
      userId: input.updatedById ?? input.acceptedById,
      deviceId: input.deviceId,
      operationId: input.operationId,
      oldValues: childBefore
        ? toAuditJson({
            centerId: childBefore.centerId,
            status: childBefore.status,
            version: childBefore.version,
          })
        : null,
      newValues: toAuditJson({
        centerId: child.centerId,
        status: child.status,
        version: child.version,
      }),
      changedAt: now,
      metadata: {
        transferId: transfer.id,
        fromCenterId: existing.fromCenterId,
        toCenterId: existing.toCenterId,
      },
    });

    return { status: 'applied', transfer, child };
  }

  async cancel(
    tx: Prisma.TransactionClient,
    input: CancelTransferInput,
  ): Promise<TransferLifecycleResult> {
    const now = new Date();

    const existing = await tx.childTransfer.findFirst({
      where: { id: input.transferId, deletedAt: null },
    });

    if (!existing) {
      return { status: 'conflict', conflictReason: 'Transfer not found' };
    }

    if (existing.status !== TransferStatus.pending) {
      return {
        status: 'conflict',
        conflictReason: `Cannot cancel transfer in status ${existing.status}`,
      };
    }

    if (existing.version !== input.transferVersion) {
      return {
        status: 'conflict',
        conflictReason: `Transfer version mismatch: client ${input.transferVersion}, server ${existing.version}`,
      };
    }

    const childBefore = await tx.child.findUnique({
      where: { id: existing.childId },
    });

    const transferUpdate = await tx.childTransfer.updateMany({
      where: {
        id: input.transferId,
        status: TransferStatus.pending,
        version: input.transferVersion,
        deletedAt: null,
      },
      data: {
        ...this.lookupDw.transferStatus(TransferStatus.cancelled),
        updatedAt: now,
        version: { increment: 1 },
        syncStatus: RecordSyncStatus.synced,
        lastModifiedByDeviceId: input.deviceId,
        lastModifiedAt: now,
      },
    });

    if (transferUpdate.count === 0) {
      return {
        status: 'conflict',
        conflictReason: 'Transfer could not be cancelled (concurrent update)',
      };
    }

    const childUpdate = await tx.child.updateMany({
      where: {
        id: existing.childId,
        version: input.childVersion,
        deletedAt: null,
      },
      data: {
        ...this.lookupDw.childStatus(ChildStatus.active),
        updatedAt: now,
        ...(input.updatedById != null ? { updatedById: input.updatedById } : {}),
        version: { increment: 1 },
        syncStatus: RecordSyncStatus.synced,
        lastModifiedByDeviceId: input.deviceId,
        lastModifiedAt: now,
      },
    });

    if (childUpdate.count === 0) {
      // Ensure the transaction rolls back the transfer status change and surface a clean 409.
      throw new OptimisticLockConflictException('child_transfer', childBefore?.version);
    }

    const transfer = await tx.childTransfer.findUniqueOrThrow({
      where: { id: input.transferId },
    });
    const child = await tx.child.findUniqueOrThrow({
      where: { id: existing.childId },
    });

    await this.audit.log({
      tx,
      entityType: 'child_transfer',
      entityId: transfer.id,
      action: AuditAction.TRANSFER_CANCEL,
      userId: input.updatedById ?? null,
      deviceId: input.deviceId,
      operationId: input.operationId,
      oldValues: toAuditJson(existing),
      newValues: toAuditJson(transfer),
      changedAt: now,
    });

    await this.audit.log({
      tx,
      entityType: 'child',
      entityId: child.id,
      action: AuditAction.TRANSFER_CANCEL,
      userId: input.updatedById ?? null,
      deviceId: input.deviceId,
      operationId: input.operationId,
      oldValues: childBefore
        ? toAuditJson({
            centerId: childBefore.centerId,
            status: childBefore.status,
            version: childBefore.version,
          })
        : null,
      newValues: toAuditJson({
        centerId: child.centerId,
        status: child.status,
        version: child.version,
      }),
      changedAt: now,
      metadata: {
        transferId: transfer.id,
      },
    });

    return { status: 'applied', transfer, child };
  }

  private async childConflict(
    tx: Prisma.TransactionClient,
    childId: string,
    fromCenterId: string,
    childVersion: number,
  ): Promise<TransferLifecycleResult> {
    const child = await tx.child.findUnique({
      where: { id: childId },
      select: {
        id: true,
        version: true,
        centerId: true,
        deletedAt: true,
        status: true,
      },
    });

    if (!child || child.deletedAt) {
      return { status: 'conflict', conflictReason: 'Child not found for transfer' };
    }

    if (child.status === ChildStatus.archived) {
      return { status: 'conflict', conflictReason: 'Cannot transfer an archived child' };
    }

    if (child.centerId !== fromCenterId) {
      return {
        status: 'conflict',
        conflictReason: `child.centerId does not match from_center_id (current: ${child.centerId})`,
      };
    }

    return {
      status: 'conflict',
      conflictReason: `Child version mismatch: client ${childVersion}, server ${child.version}`,
    };
  }
}

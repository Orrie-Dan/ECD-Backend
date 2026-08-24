import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { AuditAction, SyncOperationStatus, SyncSessionStatus } from '@prisma/client';
import { Job } from 'bullmq';
import { AuditService, fromPrismaAuditAction } from '../../common/audit';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../auth/interfaces/jwt-payload.interface';
import { SyncAccessService } from './sync-access.service';
import { SyncApplyService } from './sync-apply.service';
import { SyncService } from './sync.service';
import {
  SYNC_JOB_PROCESS_SESSION,
  SYNC_JOB_RECOVER_STALE,
  SYNC_QUEUE,
  SYNC_WORKER_CONCURRENCY,
  SYNC_WORKER_LOCK_DURATION_MS,
  SYNC_WORKER_MAX_STALLED_COUNT,
  SYNC_WORKER_STALLED_INTERVAL_MS,
  SYNCABLE_ENTITY_TYPES,
  SyncJobPayload,
  SyncableEntityType,
} from './sync.constants';

@Processor(SYNC_QUEUE, {
  concurrency: SYNC_WORKER_CONCURRENCY,
  lockDuration: SYNC_WORKER_LOCK_DURATION_MS,
  stalledInterval: SYNC_WORKER_STALLED_INTERVAL_MS,
  maxStalledCount: SYNC_WORKER_MAX_STALLED_COUNT,
})
export class SyncProcessor extends WorkerHost {
  private readonly logger = new Logger(SyncProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly syncApplyService: SyncApplyService,
    private readonly syncAccess: SyncAccessService,
    private readonly audit: AuditService,
    private readonly syncService: SyncService,
  ) {
    super();
  }

  async process(job: Job<SyncJobPayload | Record<string, never>>): Promise<void> {
    if (job.name === SYNC_JOB_RECOVER_STALE) {
      await this.syncService.recoverStalePendingSessions();
      return;
    }

    if (job.name !== SYNC_JOB_PROCESS_SESSION) {
      this.logger.warn(`Ignoring unknown sync job: ${job.name}`);
      return;
    }

    const { sessionId } = job.data as SyncJobPayload;
    this.logger.log(`Processing sync session ${sessionId}`);

    const session = await this.prisma.syncSession.findUnique({
      where: { id: sessionId },
      include: {
        device: {
          include: {
            user: true,
          },
        },
      },
    });

    if (!session) {
      this.logger.warn(`Sync session ${sessionId} not found`);
      return;
    }

    const user = this.toAuthUser(session.device.user);
    const scope = await this.syncAccess.resolveScope(user);

    const operations = await this.prisma.syncOperation.findMany({
      where: {
        sessionId,
        status: SyncOperationStatus.pending,
      },
      orderBy: { createdAt: 'asc' },
    });

    for (const op of operations) {
      // Skip if another worker already finalized this op (recovery requeue race).
      const stillPending = await this.prisma.syncOperation.findUnique({
        where: { id: op.id },
        select: { status: true },
      });
      if (!stillPending || stillPending.status !== SyncOperationStatus.pending) {
        continue;
      }

      if (!SYNCABLE_ENTITY_TYPES.includes(op.entityType as SyncableEntityType)) {
        await this.finalizeOperation(op.id, {
          status: SyncOperationStatus.failed,
          conflictReason: `Unsupported entity type: ${op.entityType}`,
        });
        continue;
      }

      const payload =
        op.payload && typeof op.payload === 'object' && !Array.isArray(op.payload)
          ? (op.payload as Record<string, unknown>)
          : {};

      const auth = await this.syncAccess.authorizeSyncWrite({
        user,
        scope,
        entityType: op.entityType,
        entityId: op.entityId,
        operation: op.operation as AuditAction,
        payload,
      });

      if (!auth.allowed) {
        this.syncAccess.logRejectedSyncOperation({
          userId: user.id,
          role: user.role,
          entityType: op.entityType,
          entityId: op.entityId,
          reason: auth.reason,
        });
        await this.finalizeOperation(op.id, {
          status: SyncOperationStatus.failed,
          conflictReason: auth.reason,
        });
        continue;
      }

      const clientVersion =
        typeof payload.__clientVersion === 'number' ? payload.__clientVersion : 0;

      const result = await this.prisma.$transaction(async (tx) => {
        // Row lock + status check prevents double-apply under concurrent recovery.
        const locked = await tx.$queryRaw<Array<{ id: string; status: SyncOperationStatus }>>`
          SELECT id, status FROM sync_operation WHERE id = ${op.id} FOR UPDATE
        `;
        if (!locked[0] || locked[0].status !== SyncOperationStatus.pending) {
          return { skipped: true as const };
        }

        const applyResult = await this.syncApplyService.apply({
          deviceId: op.deviceId,
          entityType: op.entityType as SyncableEntityType,
          entityId: op.entityId,
          localId: op.localId,
          operation: op.operation as AuditAction,
          payload,
          clientVersion,
          clientTimestamp: op.clientTimestamp,
          tx,
        });

        if (applyResult.retryable || applyResult.status === SyncOperationStatus.pending) {
          await tx.syncOperation.update({
            where: { id: op.id },
            data: {
              conflictReason: applyResult.conflictReason,
            },
          });
          return { skipped: false as const, applyResult };
        }

        await tx.syncOperation.update({
          where: { id: op.id },
          data: {
            status: applyResult.status,
            conflictReason: applyResult.conflictReason,
            entityId: applyResult.entityId,
            processedAt: new Date(),
          },
        });

        // child_transfer is audited inside TransferLifecycleService with
        // full old/new snapshots — skip the generic sync apply audit.
        if (
          applyResult.status === SyncOperationStatus.applied &&
          op.entityType !== 'child_transfer'
        ) {
          await this.audit.log({
            tx,
            entityType: op.entityType,
            entityId: applyResult.entityId ?? op.entityId,
            action: fromPrismaAuditAction(op.operation),
            userId: user.id,
            deviceId: op.deviceId,
            operationId: op.clientOperationId ?? op.id,
            newValues: Object.keys(payload).length > 0 ? payload : null,
            metadata: { source: 'sync' },
          });
        }

        return { skipped: false as const, applyResult };
      });

      if (result.skipped) {
        continue;
      }

      this.logger.log(
        JSON.stringify({
          event: 'sync.apply',
          sessionId,
          deviceId: op.deviceId,
          clientOperationId: op.clientOperationId,
          entityType: op.entityType,
          entityId: result.applyResult.entityId ?? op.entityId,
          status: result.applyResult.status,
          retryable: result.applyResult.retryable ?? false,
          conflictReason: result.applyResult.conflictReason ?? null,
        }),
      );

      if (result.applyResult.retryable) {
        continue;
      }

      if (result.applyResult.status === SyncOperationStatus.failed) {
        this.logger.warn(
          JSON.stringify({
            event: 'sync.apply.failed',
            sessionId,
            deviceId: op.deviceId,
            clientOperationId: op.clientOperationId,
            entityType: op.entityType,
            entityId: op.entityId,
            conflictReason: result.applyResult.conflictReason ?? 'unknown',
          }),
        );
      }
    }

    const allOps = await this.prisma.syncOperation.findMany({
      where: { sessionId },
      select: { status: true },
    });

    const pendingLeft = allOps.some((o) => o.status === SyncOperationStatus.pending);
    if (pendingLeft) {
      // Concurrent recovery worker may still be applying; leave session started.
      this.logger.warn(`Sync session ${sessionId} still has pending ops; leaving status=started`);
      return;
    }

    const successful = allOps.filter((o) => o.status === SyncOperationStatus.applied).length;
    const failed = allOps.filter((o) => o.status !== SyncOperationStatus.applied).length;

    const sessionStatus =
      failed > 0 && successful === 0 ? SyncSessionStatus.failed : SyncSessionStatus.completed;

    await this.prisma.syncSession.update({
      where: { id: sessionId },
      data: {
        successfulOperations: successful,
        failedOperations: failed,
        completedAt: new Date(),
        status: sessionStatus,
      },
    });

    await this.prisma.device.update({
      where: { id: session.deviceId },
      data: { lastSyncAt: new Date() },
    });

    this.logger.log(
      JSON.stringify({
        event: 'sync.session.finished',
        sessionId,
        deviceId: session.deviceId,
        status: sessionStatus,
        applied: successful,
        failed,
      }),
    );
  }

  private toAuthUser(user: {
    id: string;
    username: string;
    email: string | null;
    fullName: string;
    role: AuthUser['role'];
    centerId: string | null;
    districtId: string | null;
    status: string;
  }): AuthUser {
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      centerId: user.centerId,
      districtId: user.districtId,
      status: user.status,
    };
  }

  private async finalizeOperation(
    operationId: string,
    data: {
      status: SyncOperationStatus;
      conflictReason?: string;
      entityId?: string;
    },
  ): Promise<void> {
    await this.prisma.syncOperation.update({
      where: { id: operationId },
      data: {
        status: data.status,
        conflictReason: data.conflictReason,
        ...(data.entityId ? { entityId: data.entityId } : {}),
        processedAt: new Date(),
      },
    });
  }
}

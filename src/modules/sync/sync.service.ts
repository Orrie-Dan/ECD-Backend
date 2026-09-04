import { DeviceStatus, SyncSessionStatus } from '../../common/domain';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Prisma, SyncOperationStatus } from '@prisma/client';
import { Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../auth/interfaces/jwt-payload.interface';
import { SyncPullQueryDto } from './dto/sync-pull-query.dto';
import { SyncPushDto } from './dto/sync-push.dto';
import { SyncAccessService } from './sync-access.service';
import {
  SYNC_JOB_PROCESS_SESSION,
  SYNC_JOB_RECOVER_STALE,
  SYNC_MAX_RECOVERY_RETRIES,
  SYNC_PARKED_RETRY_MS,
  SYNC_PULL_DEFAULT_LIMIT,
  SYNC_PULL_MAX_LIMIT,
  SYNC_QUEUE,
  SYNC_RECOVERY_INTERVAL_MS,
  SYNC_STALE_THRESHOLD_MS,
  SYNCABLE_ENTITY_TYPES,
  SyncJobPayload,
  SyncPullCursor,
  SyncableEntityType,
} from './sync.constants';
import {
  KEYSET_ORDER_BY,
  andWhere,
  bucketRows,
  buildKeysetWhere,
  paginateMergedRows,
} from './sync-pull.util';

@Injectable()
export class SyncService implements OnModuleInit {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly syncAccess: SyncAccessService,
    @InjectQueue(SYNC_QUEUE)
    private readonly syncQueue: Queue<SyncJobPayload | Record<string, never>>,
  ) {}

  async onModuleInit() {
    // Repeatable Bull job recovers sessions whose process-session jobs were lost.
    try {
      await this.syncQueue.add(
        SYNC_JOB_RECOVER_STALE,
        {},
        {
          repeat: { every: SYNC_RECOVERY_INTERVAL_MS },
          jobId: 'sync-stale-recovery',
          removeOnComplete: true,
          removeOnFail: 50,
        },
      );
    } catch (err) {
      this.logger.warn(
        `Could not register recover-stale repeatable job: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  async push(user: AuthUser, dto: SyncPushDto) {
    const device = await this.prisma.device.findUnique({
      where: { id: dto.deviceId },
    });

    if (!device) {
      throw new NotFoundException('Device not found');
    }

    if (device.userId !== user.id) {
      throw new ForbiddenException('Device does not belong to the authenticated user');
    }

    if (device.status !== DeviceStatus.active) {
      throw new ForbiddenException('Device is inactive');
    }

    const seenClientOpIds = new Set<string>();
    for (const op of dto.operations) {
      if (!SYNCABLE_ENTITY_TYPES.includes(op.entityType as SyncableEntityType)) {
        throw new BadRequestException(`Unsupported entity type: ${op.entityType}`);
      }
      if (seenClientOpIds.has(op.clientOperationId)) {
        throw new BadRequestException(
          `Duplicate clientOperationId in batch: ${op.clientOperationId}`,
        );
      }
      seenClientOpIds.add(op.clientOperationId);
    }

    const scope = await this.syncAccess.resolveScope(user);
    const clientOperationIds = dto.operations.map((op) => op.clientOperationId);

    const existingOps = await this.prisma.syncOperation.findMany({
      where: {
        deviceId: device.id,
        clientOperationId: { in: clientOperationIds },
      },
    });
    const existingByClientOpId = new Map(
      existingOps
        .filter((row) => row.clientOperationId != null)
        .map((row) => [row.clientOperationId as string, row]),
    );

    type PushOpResult = {
      id: string;
      clientOperationId: string;
      localId: string | null;
      entityId: string;
      entityType: string;
      operation: (typeof dto.operations)[number]['operation'];
      status: SyncOperationStatus;
      conflictReason: string | null;
      replayed: boolean;
      sessionId: string | null;
    };

    const results: PushOpResult[] = [];
    const toCreate: Array<{
      id: string;
      deviceId: string;
      sessionId: string | null;
      clientOperationId: string;
      entityType: string;
      entityId: string;
      localId: string | null;
      operation: (typeof dto.operations)[number]['operation'];
      payload: Prisma.InputJsonValue;
      status: SyncOperationStatus;
      conflictReason: string | null;
      clientTimestamp: Date;
      createdAt: Date;
      processedAt?: Date;
    }> = [];

    const sessionId = randomUUID();
    const now = new Date();

    for (const op of dto.operations) {
      const existing = existingByClientOpId.get(op.clientOperationId);
      if (existing) {
        results.push({
          id: existing.id,
          clientOperationId: op.clientOperationId,
          localId: existing.localId,
          entityId: existing.entityId,
          entityType: existing.entityType,
          operation: existing.operation,
          status: existing.status,
          conflictReason: existing.conflictReason,
          replayed: true,
          sessionId: existing.sessionId,
        });
        continue;
      }

      const entityId = op.entityId ?? randomUUID();
      const payload = {
        ...(op.payload ?? {}),
        __clientVersion: op.version,
        __localId: op.localId ?? null,
        __clientOperationId: op.clientOperationId,
        __clientTimestamp: op.clientTimestamp ?? null,
      };

      const auth = await this.syncAccess.authorizeSyncWrite({
        user,
        scope,
        entityType: op.entityType,
        entityId,
        operation: op.operation,
        payload,
      });

      if (!auth.allowed) {
        this.syncAccess.logRejectedSyncOperation({
          userId: user.id,
          role: user.role,
          entityType: op.entityType,
          entityId,
          reason: auth.reason,
        });
      }

      const rowId = randomUUID();
      const status = auth.allowed ? SyncOperationStatus.pending : SyncOperationStatus.failed;
      const conflictReason = auth.allowed ? null : auth.reason;

      toCreate.push({
        id: rowId,
        deviceId: device.id,
        sessionId: null,
        clientOperationId: op.clientOperationId,
        entityType: op.entityType,
        entityId,
        localId: op.localId ?? null,
        operation: op.operation,
        payload: payload as Prisma.InputJsonValue,
        status,
        conflictReason,
        clientTimestamp: op.clientTimestamp ? new Date(op.clientTimestamp) : now,
        createdAt: now,
        ...(auth.allowed ? {} : { processedAt: now }),
      });

      results.push({
        id: rowId,
        clientOperationId: op.clientOperationId,
        localId: op.localId ?? null,
        entityId,
        entityType: op.entityType,
        operation: op.operation,
        status,
        conflictReason,
        replayed: false,
        sessionId,
      });
    }

    const newPendingCount = toCreate.filter((r) => r.status === SyncOperationStatus.pending).length;

    let createdSessionId: string | null = null;

    if (toCreate.length > 0) {
      await this.prisma.$transaction(async (tx) => {
        const inserted: typeof toCreate = [];

        for (const row of toCreate) {
          try {
            await tx.syncOperation.create({
              data: row,
            });
            inserted.push(row);
          } catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
              const raced = await tx.syncOperation.findFirst({
                where: {
                  deviceId: device.id,
                  clientOperationId: row.clientOperationId,
                },
              });
              if (!raced) {
                throw error;
              }

              const idx = results.findIndex(
                (r) => r.clientOperationId === row.clientOperationId && !r.replayed,
              );
              if (idx >= 0) {
                results[idx] = {
                  id: raced.id,
                  clientOperationId: row.clientOperationId,
                  localId: raced.localId,
                  entityId: raced.entityId,
                  entityType: raced.entityType,
                  operation: raced.operation,
                  status: raced.status,
                  conflictReason: raced.conflictReason,
                  replayed: true,
                  sessionId: raced.sessionId,
                };
              }
              continue;
            }
            throw error;
          }
        }

        if (inserted.length === 0) {
          return;
        }

        const insertedPending = inserted.filter(
          (r) => r.status === SyncOperationStatus.pending,
        ).length;
        const insertedRejected = inserted.length - insertedPending;

        await tx.syncSession.create({
          data: {
            id: sessionId,
            deviceId: device.id,
            startedAt: now,
            totalOperations: inserted.length,
            successfulOperations: 0,
            failedOperations: insertedRejected,
            status: insertedPending === 0 ? SyncSessionStatus.completed : SyncSessionStatus.started,
            ...(insertedPending === 0 ? { completedAt: now } : {}),
          },
        });

        await tx.syncOperation.updateMany({
          where: { id: { in: inserted.map((r) => r.id) } },
          data: { sessionId },
        });

        for (const row of inserted) {
          const idx = results.findIndex(
            (r) => r.clientOperationId === row.clientOperationId && !r.replayed,
          );
          if (idx >= 0) {
            results[idx].sessionId = sessionId;
          }
        }

        createdSessionId = sessionId;
      });

      const stillPending = results.filter(
        (r) =>
          !r.replayed &&
          r.sessionId === createdSessionId &&
          r.status === SyncOperationStatus.pending,
      ).length;

      if (createdSessionId && stillPending > 0) {
        this.logger.log(
          JSON.stringify({
            event: 'sync.push.accepted',
            sessionId: createdSessionId,
            deviceId: device.id,
            userId: user.id,
            pending: stillPending,
            accepted: results.length,
          }),
        );
        try {
          await this.enqueueSession(createdSessionId, 0);
        } catch (err) {
          this.logger.error(
            JSON.stringify({
              event: 'sync.enqueue.failed',
              sessionId: createdSessionId,
              deviceId: device.id,
              userId: user.id,
              reason: err instanceof Error ? err.message : String(err),
            }),
          );
          throw err;
        }
      } else if (createdSessionId && newPendingCount === 0) {
        this.logger.warn(
          `Sync session ${createdSessionId}: all new operations rejected at push (auth)`,
        );
      }
    }

    const createdCount = results.filter((r) => !r.replayed).length;
    const finalDeduped = results.filter((r) => r.replayed).length;

    return {
      sessionId: createdSessionId,
      accepted: results.length,
      created: createdCount,
      deduplicated: finalDeduped,
      status: this.aggregatePushStatus(results.map((r) => r.status)),
      operations: results.map((row) => ({
        id: row.id,
        clientOperationId: row.clientOperationId,
        localId: row.localId,
        entityId: row.entityId,
        entityType: row.entityType,
        operation: row.operation,
        status: row.status,
        conflictReason: row.conflictReason,
        replayed: row.replayed,
        sessionId: row.sessionId,
      })),
    };
  }

  private aggregatePushStatus(statuses: SyncOperationStatus[]): SyncOperationStatus {
    if (statuses.some((s) => s === SyncOperationStatus.pending)) {
      return SyncOperationStatus.pending;
    }
    if (statuses.every((s) => s === SyncOperationStatus.applied)) {
      return SyncOperationStatus.applied;
    }
    if (statuses.every((s) => s === SyncOperationStatus.failed)) {
      return SyncOperationStatus.failed;
    }
    if (statuses.every((s) => s === SyncOperationStatus.conflict)) {
      return SyncOperationStatus.conflict;
    }
    // Mixed terminal states after full replay
    return SyncOperationStatus.applied;
  }

  async pull(user: AuthUser, query: SyncPullQueryDto) {
    if (query.deviceId) {
      const device = await this.prisma.device.findUnique({
        where: { id: query.deviceId },
      });
      if (!device || device.userId !== user.id) {
        throw new ForbiddenException('Device does not belong to the authenticated user');
      }
    }

    if (query.cursorId && !query.cursor) {
      throw new BadRequestException('cursorId requires cursor (lastModifiedAt)');
    }

    const scope = await this.syncAccess.resolveScope(user);
    const cursorTime = query.cursor ?? null;
    const cursorId = query.cursorId ?? null;
    const limit = Math.min(
      Math.max(query.limit ?? SYNC_PULL_DEFAULT_LIMIT, 1),
      SYNC_PULL_MAX_LIMIT,
    );

    const keyset = buildKeysetWhere(cursorTime, cursorId);
    const centerFilter = this.syncAccess.centerFilter(scope);
    const ecdCenterFilter = this.syncAccess.ecdCenterFilter(scope);
    // Fetch limit+1 per entity so we can detect hasMore after merge.
    const take = limit + 1;

    const nutritionScope =
      scope.centerIds === 'all' ? {} : { child: { centerId: { in: scope.centerIds } } };
    const transferScope =
      scope.centerIds === 'all'
        ? {}
        : {
            OR: [
              { fromCenterId: { in: scope.centerIds } },
              { toCenterId: { in: scope.centerIds } },
            ],
          };
    const assessmentItemScope =
      scope.centerIds === 'all' ? {} : { assessment: { centerId: { in: scope.centerIds } } };

    const [
      children,
      attendanceRecords,
      nutritionScreenings,
      childTransfers,
      ecdCenters,
      complianceAssessments,
      complianceAssessmentItems,
      washIndicators,
      feedingDays,
      feedingMonthSummaries,
      stedAssessments,
      referrals,
    ] = await Promise.all([
      this.prisma.child.findMany({
        where: andWhere(centerFilter, keyset),
        orderBy: KEYSET_ORDER_BY,
        take,
      }),
      this.prisma.attendanceRecord.findMany({
        where: andWhere(centerFilter, keyset),
        orderBy: KEYSET_ORDER_BY,
        take,
      }),
      this.prisma.childNutritionScreening.findMany({
        where: andWhere(keyset, nutritionScope),
        orderBy: KEYSET_ORDER_BY,
        take,
      }),
      this.prisma.childTransfer.findMany({
        where: andWhere(keyset, transferScope),
        orderBy: KEYSET_ORDER_BY,
        take,
      }),
      this.prisma.ecdCenter.findMany({
        where: andWhere(ecdCenterFilter, keyset),
        orderBy: KEYSET_ORDER_BY,
        take,
      }),
      this.prisma.complianceAssessment.findMany({
        where: andWhere(centerFilter, keyset),
        orderBy: KEYSET_ORDER_BY,
        take,
      }),
      this.prisma.complianceAssessmentItem.findMany({
        where: andWhere(keyset, assessmentItemScope),
        orderBy: KEYSET_ORDER_BY,
        take,
      }),
      this.prisma.washIndicator.findMany({
        where: andWhere(centerFilter, keyset),
        orderBy: KEYSET_ORDER_BY,
        take,
      }),
      this.prisma.centerFeedingDay.findMany({
        where: andWhere(centerFilter, keyset),
        orderBy: KEYSET_ORDER_BY,
        take,
      }),
      this.prisma.centerFeedingMonthSummary.findMany({
        where: andWhere(centerFilter, keyset),
        orderBy: KEYSET_ORDER_BY,
        take,
      }),
      this.prisma.stedAssessment.findMany({
        where: andWhere(centerFilter, keyset),
        orderBy: KEYSET_ORDER_BY,
        take,
      }),
      this.prisma.referral.findMany({
        where: andWhere(centerFilter, keyset),
        orderBy: KEYSET_ORDER_BY,
        take,
      }),
    ]);

    type AnyRow = { id: string; createdAt: Date; lastModifiedAt: Date; deletedAt: Date | null };
    const tagged: Array<AnyRow & { entityType: string; row: AnyRow }> = [
      ...children.map((r) => ({ ...r, entityType: 'child', row: r })),
      ...attendanceRecords.map((r) => ({
        ...r,
        entityType: 'attendance_record',
        row: r,
      })),
      ...nutritionScreenings.map((r) => ({
        ...r,
        entityType: 'child_nutrition_screening',
        row: r,
      })),
      ...childTransfers.map((r) => ({
        ...r,
        entityType: 'child_transfer',
        row: r,
      })),
      ...ecdCenters.map((r) => ({ ...r, entityType: 'ecd_center', row: r })),
      ...complianceAssessments.map((r) => ({
        ...r,
        entityType: 'compliance_assessment',
        row: r,
      })),
      ...complianceAssessmentItems.map((r) => ({
        ...r,
        entityType: 'compliance_assessment_item',
        row: r,
      })),
      ...washIndicators.map((r) => ({
        ...r,
        entityType: 'wash_indicator',
        row: r,
      })),
      ...feedingDays.map((r) => ({
        ...r,
        entityType: 'center_feeding_day',
        row: r,
      })),
      ...feedingMonthSummaries.map((r) => ({
        ...r,
        entityType: 'center_feeding_month_summary',
        row: r,
      })),
      ...stedAssessments.map((r) => ({
        ...r,
        entityType: 'sted_assessment',
        row: r,
      })),
      ...referrals.map((r) => ({ ...r, entityType: 'referral', row: r })),
    ];

    const { page, nextCursor, hasMore } = paginateMergedRows(tagged, limit);

    const byType = new Map<string, AnyRow[]>();
    for (const item of page) {
      const list = byType.get(item.entityType) ?? [];
      list.push(item.row);
      byType.set(item.entityType, list);
    }

    const watermark = cursorTime ?? new Date(0);

    const bucketsFor = (entityType: string) => {
      const rows = byType.get(entityType) ?? [];
      return bucketRows(rows, watermark);
    };

    const requestCursor: SyncPullCursor | null = cursorTime
      ? {
          lastModifiedAt: cursorTime.toISOString(),
          id: cursorId ?? '',
        }
      : null;

    return {
      cursor: requestCursor,
      nextCursor: hasMore ? nextCursor : null,
      hasMore,
      limit,
      created: {
        child: bucketsFor('child').created,
        attendance_record: bucketsFor('attendance_record').created,
        child_nutrition_screening: bucketsFor('child_nutrition_screening').created,
        child_transfer: bucketsFor('child_transfer').created,
        ecd_center: bucketsFor('ecd_center').created,
        compliance_assessment: bucketsFor('compliance_assessment').created,
        compliance_assessment_item: bucketsFor('compliance_assessment_item').created,
        wash_indicator: bucketsFor('wash_indicator').created,
        center_feeding_day: bucketsFor('center_feeding_day').created,
        center_feeding_month_summary: bucketsFor('center_feeding_month_summary').created,
        sted_assessment: bucketsFor('sted_assessment').created,
        referral: bucketsFor('referral').created,
      },
      updated: {
        child: bucketsFor('child').updated,
        attendance_record: bucketsFor('attendance_record').updated,
        child_nutrition_screening: bucketsFor('child_nutrition_screening').updated,
        child_transfer: bucketsFor('child_transfer').updated,
        ecd_center: bucketsFor('ecd_center').updated,
        compliance_assessment: bucketsFor('compliance_assessment').updated,
        compliance_assessment_item: bucketsFor('compliance_assessment_item').updated,
        wash_indicator: bucketsFor('wash_indicator').updated,
        center_feeding_day: bucketsFor('center_feeding_day').updated,
        center_feeding_month_summary: bucketsFor('center_feeding_month_summary').updated,
        sted_assessment: bucketsFor('sted_assessment').updated,
        referral: bucketsFor('referral').updated,
      },
      deleted: {
        child: bucketsFor('child').deleted,
        attendance_record: bucketsFor('attendance_record').deleted,
        child_nutrition_screening: bucketsFor('child_nutrition_screening').deleted,
        child_transfer: bucketsFor('child_transfer').deleted,
        ecd_center: bucketsFor('ecd_center').deleted,
        compliance_assessment: bucketsFor('compliance_assessment').deleted,
        compliance_assessment_item: bucketsFor('compliance_assessment_item').deleted,
        wash_indicator: bucketsFor('wash_indicator').deleted,
        center_feeding_day: bucketsFor('center_feeding_day').deleted,
        center_feeding_month_summary: bucketsFor('center_feeding_month_summary').deleted,
        sted_assessment: bucketsFor('sted_assessment').deleted,
        referral: bucketsFor('referral').deleted,
      },
    };
  }

  /**
   * Requeue stuck sessions whose pending ops never reached a terminal state
   * (worker crash, Redis outage after enqueue, Bull attempts exhausted).
   * Retryable: session status `started` with pending ops.
   * Terminal ops: applied | conflict | failed — never requeued.
   * After SYNC_MAX_RECOVERY_RETRIES: keep ops pending and retry on
   * SYNC_PARKED_RETRY_MS. Do not dead-letter caregiver data.
   */
  async recoverStalePendingSessions(now = new Date()): Promise<{
    scanned: number;
    requeued: number;
    deadLettered: number;
    parkedRequeued: number;
  }> {
    const threshold = new Date(now.getTime() - SYNC_STALE_THRESHOLD_MS);

    const staleSessions = await this.prisma.syncSession.findMany({
      where: {
        status: SyncSessionStatus.started,
        startedAt: { lt: threshold },
        operations: { some: { status: SyncOperationStatus.pending } },
      },
      select: {
        id: true,
        retryCount: true,
        startedAt: true,
        lastRetryAt: true,
        deviceId: true,
      },
      take: 100,
      orderBy: { startedAt: 'asc' },
    });

    let requeued = 0;
    const deadLettered = 0;
    let parkedRequeued = 0;

    const inFlight = await this.sessionIdsInFlight();

    for (const session of staleSessions) {
      if (inFlight.has(session.id)) {
        continue;
      }

      if (session.retryCount >= SYNC_MAX_RECOVERY_RETRIES) {
        const last = session.lastRetryAt ?? session.startedAt;
        if (now.getTime() - last.getTime() < SYNC_PARKED_RETRY_MS) {
          continue;
        }
        await this.prisma.syncSession.update({
          where: { id: session.id },
          data: { lastRetryAt: now },
        });
        await this.enqueueSession(session.id, session.retryCount);
        parkedRequeued += 1;
        this.logger.warn(
          JSON.stringify({
            event: 'sync.recovery.parked_requeue',
            sessionId: session.id,
            deviceId: session.deviceId,
            retryCount: session.retryCount,
          }),
        );
        continue;
      }

      const nextRetry = session.retryCount + 1;
      await this.prisma.syncSession.update({
        where: { id: session.id },
        data: {
          retryCount: nextRetry,
          lastRetryAt: now,
        },
      });

      await this.enqueueSession(session.id, nextRetry);
      requeued += 1;
      this.logger.warn(
        JSON.stringify({
          event: 'sync.recovery.requeue',
          sessionId: session.id,
          deviceId: session.deviceId,
          retry: nextRetry,
          max: SYNC_MAX_RECOVERY_RETRIES,
        }),
      );
    }

    if (staleSessions.length > 0) {
      this.logger.log(
        JSON.stringify({
          event: 'sync.recovery.sweep',
          scanned: staleSessions.length,
          requeued,
          parkedRequeued,
          deadLettered,
        }),
      );
    }

    return {
      scanned: staleSessions.length,
      requeued,
      deadLettered,
      parkedRequeued,
    };
  }

  private async enqueueSession(sessionId: string, retryCount: number): Promise<void> {
    await this.syncQueue.add(
      SYNC_JOB_PROCESS_SESSION,
      { sessionId },
      {
        jobId: `session-${sessionId}-r${retryCount}-${Date.now()}`,
        removeOnComplete: 100,
        removeOnFail: 200,
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
      },
    );
  }

  private async sessionIdsInFlight(): Promise<Set<string>> {
    const jobs = await this.syncQueue.getJobs(['active', 'waiting', 'delayed', 'paused']);
    const ids = new Set<string>();
    for (const job of jobs) {
      if (job.name !== SYNC_JOB_PROCESS_SESSION) continue;
      const data = job.data as SyncJobPayload;
      if (data?.sessionId) {
        ids.add(data.sessionId);
      }
    }
    return ids;
  }

  async getSessionStatus(user: AuthUser, sessionId: string) {
    const session = await this.prisma.syncSession.findUnique({
      where: { id: sessionId },
      include: {
        device: true,
        operations: {
          select: {
            id: true,
            clientOperationId: true,
            localId: true,
            entityId: true,
            entityType: true,
            operation: true,
            status: true,
            conflictReason: true,
            processedAt: true,
          },
        },
      },
    });

    if (!session) {
      throw new NotFoundException('Sync session not found');
    }

    if (session.device.userId !== user.id) {
      throw new ForbiddenException('Sync session does not belong to the authenticated user');
    }

    return {
      id: session.id,
      status: session.status,
      totalOperations: session.totalOperations,
      successfulOperations: session.successfulOperations,
      failedOperations: session.failedOperations,
      retryCount: session.retryCount,
      lastRetryAt: session.lastRetryAt,
      startedAt: session.startedAt,
      completedAt: session.completedAt,
      operations: session.operations,
    };
  }
}

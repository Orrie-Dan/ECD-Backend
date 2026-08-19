import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import {
  AuditAction,
  Prisma,
  RecordSyncStatus,
  ReferralStatus,
  SyncOperationStatus,
  TransferStatus,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { TransferLifecycleService } from '../transfers/transfer-lifecycle.service';
import {
  resolveAbsentReasonFromPayload,
  resolveAttendanceStatusFromPayload,
} from '../attendance/mappers/attendance.mapper';
import {
  deriveRequiresReferral,
} from '../nutrition/mappers/nutrition.mapper';
import {
  canTransitionReferralStatus,
  resolveReferralRecordedByIdFromPayload,
  resolveReferralSourceTypeFromPayload,
  resolveReferralStatusFromPayload,
} from '../referrals/mappers/referral.mapper';
import {
  resolveStedAgeBandFromPayload,
} from '../sted/mappers/sted.mapper';
import {
  resolveFeedingRecordedByIdFromPayload,
  resolveFeedingRecordedDateFromPayload,
} from '../feeding/mappers/feeding.mapper';
import { resolveChildGenderFromPayload } from '../children/mappers/child.mapper';
import {
  CHILD_SCOPED_ENTITY_TYPES,
  SyncableEntityType,
} from './sync.constants';

type JsonPayload = Record<string, unknown>;

export interface ApplyContext {
  deviceId: string;
  entityType: SyncableEntityType;
  entityId: string;
  localId: string | null;
  operation: AuditAction;
  payload: JsonPayload;
  clientVersion: number;
  /** Client wall-clock for natural-key last-write comparison. */
  clientTimestamp?: Date;
  /** Optional tx so caller can finalize sync_operation in the same transaction */
  tx?: Prisma.TransactionClient;
}

export interface ApplyResult {
  status: SyncOperationStatus;
  conflictReason?: string;
  entityId: string;
  /** Transient: leave the operation pending for replay. */
  retryable?: boolean;
}

type CasOutcome =
  | { kind: 'applied' }
  | { kind: 'not_found' }
  | { kind: 'version_mismatch'; serverVersion: number };

@Injectable()
export class SyncApplyService {
  private readonly logger = new Logger(SyncApplyService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => TransferLifecycleService))
    private readonly transferLifecycle: TransferLifecycleService,
  ) {}

  async apply(context: ApplyContext): Promise<ApplyResult> {
    switch (context.operation) {
      case AuditAction.create:
        return this.applyCreate(context);
      case AuditAction.update:
        return this.applyUpdate(context);
      case AuditAction.delete:
        return this.applyDelete(context);
      default:
        return {
          status: SyncOperationStatus.failed,
          conflictReason: `Unsupported operation: ${context.operation}`,
          entityId: context.entityId,
        };
    }
  }

  private db(context: ApplyContext): Prisma.TransactionClient | PrismaService {
    return context.tx ?? this.prisma;
  }

  private async applyCreate(context: ApplyContext) {
    const existing = await this.findRecord(context.entityType, context.entityId, context);
    if (existing) {
      return {
        status: SyncOperationStatus.conflict,
        conflictReason: 'Entity already exists on server',
        entityId: context.entityId,
      };
    }

    try {
      if (context.entityType === 'child_transfer') {
        return await this.applyChildTransferCreate(context);
      }

      if (context.entityType === 'attendance_record') {
        return await this.applyAttendanceCreate(context);
      }

      if (context.entityType === 'center_feeding_day') {
        // Must await: bare return of a rejecting promise bypasses this catch,
        // which left feeding ops pending with null conflictReason on LIVE.
        return await this.applyFeedingDayCreate(context);
      }

      if (context.entityType === 'center_feeding_month_summary') {
        return await this.applyFeedingMonthCreate(context);
      }

      const missingParent = await this.missingParentChild(context);
      if (missingParent) {
        return missingParent;
      }

      await this.createRecord(context);
      return { status: SyncOperationStatus.applied, entityId: context.entityId };
    } catch (error) {
      if (isRetryableApplyError(error)) {
        this.logger.warn(
          JSON.stringify({
            event: 'sync.apply.retryable',
            entityType: context.entityType,
            entityId: context.entityId,
            deviceId: context.deviceId,
            reason: error instanceof Error ? error.message : 'retryable create failure',
          }),
        );
        return {
          status: SyncOperationStatus.pending,
          retryable: true,
          conflictReason: `RETRYABLE: ${error instanceof Error ? error.message : 'Create failed'}`,
          entityId: context.entityId,
        };
      }
      this.logger.error(
        JSON.stringify({
          event: 'sync.apply.failed',
          entityType: context.entityType,
          entityId: context.entityId,
          deviceId: context.deviceId,
          reason: error instanceof Error ? error.message : 'Create failed',
        }),
      );
      return {
        status: SyncOperationStatus.failed,
        conflictReason: error instanceof Error ? error.message : 'Create failed',
        entityId: context.entityId,
      };
    }
  }

  private async applyChildTransferCreate(context: ApplyContext) {
    const payload = context.payload;
    const db = this.db(context);
    const childId = String(payload.childId);
    const fromCenterId = String(payload.fromCenterId);
    const toCenterId = String(payload.toCenterId);

    let childVersion = Number(payload.childVersion ?? payload.__childVersion);
    if (!Number.isFinite(childVersion)) {
      const child = await db.child.findUnique({
        where: { id: childId },
        select: { version: true },
      });
      if (!child) {
        return {
          status: SyncOperationStatus.conflict,
          conflictReason: 'Child not found for transfer',
          entityId: context.entityId,
        };
      }
      childVersion = child.version;
    }

    const meta = this.syncMeta(
      context.deviceId,
      Math.max(1, context.clientVersion || 1),
    );

    const result = await this.transferLifecycle.createPending(db, {
      transferId: context.entityId || randomUUID(),
      childId,
      fromCenterId,
      toCenterId,
      transferDate: new Date(String(payload.transferDate)),
      reason: String(payload.reason),
      notes: (payload.notes as string) ?? null,
      initiatedById: String(payload.initiatedById ?? payload.initiatedBy),
      deviceId: context.deviceId,
      childVersion,
      transferMeta: meta,
    });

    if (result.status === 'conflict') {
      return {
        status: SyncOperationStatus.conflict,
        conflictReason: result.conflictReason,
        entityId: context.entityId,
      };
    }

    return {
      status: SyncOperationStatus.applied,
      entityId: result.transfer.id,
    };
  }

  private async applyFeedingDayCreate(context: ApplyContext) {
    const payload = context.payload;
    const db = this.db(context);
    const centerId = String(payload.centerId ?? '');
    if (!centerId) {
      throw new Error('center_feeding_day requires centerId');
    }
    // Validate before Prisma: missing date → Invalid Date hung/retried as pending;
    // missing recorder → String(undefined) → P2003 retry loop (same class as referral).
    const recordedDate = resolveFeedingRecordedDateFromPayload(payload);
    const recordedById = resolveFeedingRecordedByIdFromPayload(payload);
    const recorder = await db.userAccount.findUnique({
      where: { id: recordedById },
      select: { id: true },
    });
    if (!recorder) {
      throw new Error(
        'center_feeding_day recordedById does not reference an existing user',
      );
    }

    const meta = this.syncMeta(
      context.deviceId,
      Math.max(1, context.clientVersion || 1),
    );

    const existing = await db.centerFeedingDay.findFirst({
      where: { centerId, recordedDate },
    });

    const data = {
      milkServed: Boolean(payload.milkServed ?? false),
      porridgeServed: Boolean(payload.porridgeServed ?? false),
      balancedMealServed: Boolean(payload.balancedMealServed ?? false),
      cerealsOrTubers: Boolean(payload.cerealsOrTubers ?? false),
      legumes: Boolean(payload.legumes ?? false),
      dairy: Boolean(payload.dairy ?? false),
      animalProducts: Boolean(payload.animalProducts ?? false),
      fruitsVegetables: Boolean(payload.fruitsVegetables ?? false),
      addedFat: Boolean(payload.addedFat ?? false),
      recordedById,
      deletedAt: null,
      updatedAt: new Date(),
      ...meta,
      lastModifiedByDeviceId:
        typeof payload.deviceId === 'string'
          ? payload.deviceId
          : meta.lastModifiedByDeviceId,
    };

    if (existing) {
      await db.centerFeedingDay.update({
        where: { id: existing.id },
        data: {
          ...data,
          version: { increment: 1 },
        },
      });
      return { status: SyncOperationStatus.applied, entityId: existing.id };
    }

    const id = context.entityId || randomUUID();
    await db.centerFeedingDay.create({
      data: {
        id,
        centerId,
        recordedDate,
        ...data,
      },
    });
    return { status: SyncOperationStatus.applied, entityId: id };
  }

  private async applyFeedingMonthCreate(context: ApplyContext) {
    const payload = context.payload;
    const db = this.db(context);
    const centerId = String(payload.centerId);
    const yearMonth = String(payload.yearMonth);
    const meta = this.syncMeta(
      context.deviceId,
      Math.max(1, context.clientVersion || 1),
    );

    const existing = await db.centerFeedingMonthSummary.findFirst({
      where: { centerId, yearMonth },
    });

    const data = {
      milkLiters: new Prisma.Decimal(String(payload.milkLiters ?? 0)),
      flourKg: new Prisma.Decimal(String(payload.flourKg ?? 0)),
      foodSource: String(payload.foodSource),
      updatedById:
        typeof (payload.updatedById ?? payload.recordedById ?? payload.recordedBy) ===
        'string'
          ? String(payload.updatedById ?? payload.recordedById ?? payload.recordedBy)
          : null,
      deletedAt: null,
      updatedAt: new Date(),
      ...meta,
      lastModifiedByDeviceId:
        typeof payload.deviceId === 'string'
          ? payload.deviceId
          : meta.lastModifiedByDeviceId,
    };

    if (existing) {
      await db.centerFeedingMonthSummary.update({
        where: { id: existing.id },
        data: {
          ...data,
          version: { increment: 1 },
        },
      });
      return { status: SyncOperationStatus.applied, entityId: existing.id };
    }

    const id = context.entityId || randomUUID();
    await db.centerFeedingMonthSummary.create({
      data: {
        id,
        centerId,
        yearMonth,
        ...data,
      },
    });
    return { status: SyncOperationStatus.applied, entityId: id };
  }

  /**
   * Attendance natural key is (childId, attendanceDate).
   * Duplicate client UUIDs for the same logical day must not become terminal `failed`.
   */
  private async applyAttendanceCreate(context: ApplyContext): Promise<ApplyResult> {
    const payload = context.payload;
    const db = this.db(context);
    const childId = String(payload.childId ?? '');
    if (!childId) {
      return {
        status: SyncOperationStatus.failed,
        conflictReason: 'attendance_record requires childId',
        entityId: context.entityId,
      };
    }

    const child = await db.child.findUnique({
      where: { id: childId },
      select: { id: true, centerId: true },
    });
    if (!child) {
      return {
        status: SyncOperationStatus.pending,
        retryable: true,
        conflictReason: 'RETRYABLE: parent child not yet applied',
        entityId: context.entityId,
      };
    }

    let centerId =
      typeof payload.centerId === 'string' ? payload.centerId : null;
    if (!centerId) {
      centerId = child.centerId;
    }
    if (!centerId) {
      return {
        status: SyncOperationStatus.failed,
        conflictReason: 'attendance_record requires centerId or a valid childId',
        entityId: context.entityId,
      };
    }

    const attendanceDateRaw = payload.attendanceDate ?? payload.date ?? null;
    if (attendanceDateRaw == null) {
      return {
        status: SyncOperationStatus.failed,
        conflictReason: 'attendance_record requires attendanceDate (or date)',
        entityId: context.entityId,
      };
    }
    const attendanceDate = new Date(String(attendanceDateRaw));

    const status = resolveAttendanceStatusFromPayload(payload);
    const absentReason = resolveAbsentReasonFromPayload(payload, status);
    const meta = this.syncMeta(
      context.deviceId,
      Math.max(1, context.clientVersion || 1),
    );
    const fieldData = {
      status,
      broughtBy: (payload.broughtBy as string) ?? null,
      broughtByOther: (payload.broughtByOther as string) ?? null,
      arrivedAt: payload.arrivedAt
        ? new Date(String(payload.arrivedAt))
        : null,
      absentReason,
      notes: (payload.notes as string) ?? null,
      recordedById: String(payload.recordedById ?? payload.recordedBy),
      deletedAt: null,
      ...meta,
      lastModifiedByDeviceId:
        typeof payload.deviceId === 'string'
          ? payload.deviceId
          : meta.lastModifiedByDeviceId,
    };

    const existing = await db.attendanceRecord.findFirst({
      where: { childId, attendanceDate },
    });

    if (existing) {
      return this.mergeAttendanceNaturalKey(context, existing, fieldData);
    }

    try {
      const id = context.entityId || randomUUID();
      await db.attendanceRecord.create({
        data: {
          id,
          childId,
          centerId,
          attendanceDate,
          ...fieldData,
        },
      });
      return { status: SyncOperationStatus.applied, entityId: id };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const raced = await db.attendanceRecord.findFirst({
          where: { childId, attendanceDate },
        });
        if (raced) {
          return this.mergeAttendanceNaturalKey(context, raced, fieldData);
        }
      }
      if (isRetryableApplyError(error)) {
        return {
          status: SyncOperationStatus.pending,
          retryable: true,
          conflictReason: `RETRYABLE: ${error instanceof Error ? error.message : 'Create failed'}`,
          entityId: context.entityId,
        };
      }
      throw error;
    }
  }

  private async mergeAttendanceNaturalKey(
    context: ApplyContext,
    existing: {
      id: string;
      version: number;
      lastModifiedAt: Date;
    },
    fieldData: Prisma.AttendanceRecordUpdateManyMutationInput,
  ): Promise<ApplyResult> {
    const db = this.db(context);
    const clientTs = context.clientTimestamp?.getTime() ?? 0;
    const serverTs = existing.lastModifiedAt.getTime();

    // Same logical record. If the existing row is newer or equal, this create
    // is an idempotent duplicate — do not insert a second row.
    if (clientTs > 0 && serverTs >= clientTs) {
      return { status: SyncOperationStatus.applied, entityId: existing.id };
    }

    const updated = await db.attendanceRecord.updateMany({
      where: { id: existing.id, version: existing.version },
      data: {
        ...fieldData,
        version: { increment: 1 },
      },
    });
    if (updated.count === 1) {
      return { status: SyncOperationStatus.applied, entityId: existing.id };
    }

    const latest = await db.attendanceRecord.findUnique({
      where: { id: existing.id },
      select: { version: true },
    });
    return {
      status: SyncOperationStatus.conflict,
      conflictReason: `version mismatch: client ${existing.version}, server ${latest?.version ?? existing.version}`,
      entityId: existing.id,
    };
  }

  private async missingParentChild(
    context: ApplyContext,
  ): Promise<ApplyResult | null> {
    if (
      !CHILD_SCOPED_ENTITY_TYPES.includes(
        context.entityType as (typeof CHILD_SCOPED_ENTITY_TYPES)[number],
      )
    ) {
      return null;
    }
    const childId = context.payload.childId;
    if (typeof childId !== 'string' || !childId) {
      return null;
    }
    const db = this.db(context);
    const child = await db.child.findUnique({
      where: { id: childId },
      select: { id: true },
    });
    if (child) {
      return null;
    }
    return {
      status: SyncOperationStatus.pending,
      retryable: true,
      conflictReason: 'RETRYABLE: parent child not yet applied',
      entityId: context.entityId,
    };
  }

  private async applyUpdate(context: ApplyContext) {
    if (
      context.entityType === 'child_nutrition_screening' ||
      context.entityType === 'sted_assessment'
    ) {
      return {
        status: SyncOperationStatus.failed,
        conflictReason: `${context.entityType} is append-only and cannot be updated`,
        entityId: context.entityId,
      };
    }

    if (context.entityType === 'child_transfer') {
      return this.applyChildTransferUpdate(context);
    }

    if (context.entityType === 'referral') {
      return this.applyReferralUpdate(context);
    }

    try {
      const outcome = await this.casUpdate(context);
      if (outcome.kind === 'applied') {
        return { status: SyncOperationStatus.applied, entityId: context.entityId };
      }
      if (outcome.kind === 'not_found') {
        return {
          status: SyncOperationStatus.failed,
          conflictReason: 'Entity not found for update',
          entityId: context.entityId,
        };
      }
      return {
        status: SyncOperationStatus.conflict,
        conflictReason: `version mismatch: client ${context.clientVersion}, server ${outcome.serverVersion}`,
        entityId: context.entityId,
      };
    } catch (error) {
      if (isRetryableApplyError(error)) {
        return {
          status: SyncOperationStatus.pending,
          retryable: true,
          conflictReason: `RETRYABLE: ${error instanceof Error ? error.message : 'Update failed'}`,
          entityId: context.entityId,
        };
      }
      this.logger.error(`UPDATE failed for ${context.entityType}`, error);
      return {
        status: SyncOperationStatus.failed,
        conflictReason: error instanceof Error ? error.message : 'Update failed',
        entityId: context.entityId,
      };
    }
  }

  private async applyChildTransferUpdate(context: ApplyContext) {
    const payload = context.payload;
    const targetStatus = String(payload.status ?? '');
    const db = this.db(context);

    if (
      targetStatus !== TransferStatus.accepted &&
      targetStatus !== TransferStatus.cancelled
    ) {
      return {
        status: SyncOperationStatus.failed,
        conflictReason:
          'child_transfer update only allows pending→accepted or pending→cancelled',
        entityId: context.entityId,
      };
    }

    const transfer = await db.childTransfer.findUnique({
      where: { id: context.entityId },
      select: {
        id: true,
        version: true,
        status: true,
        childId: true,
      },
    });

    if (!transfer) {
      return {
        status: SyncOperationStatus.failed,
        conflictReason: 'Transfer not found for update',
        entityId: context.entityId,
      };
    }

    if (transfer.status !== TransferStatus.pending) {
      return {
        status: SyncOperationStatus.failed,
        conflictReason: `Cannot transition transfer from ${transfer.status} to ${targetStatus}`,
        entityId: context.entityId,
      };
    }

    const transferVersion =
      context.clientVersion > 0 ? context.clientVersion : transfer.version;

    let childVersion = Number(payload.childVersion ?? payload.__childVersion);
    if (!Number.isFinite(childVersion)) {
      const child = await db.child.findUnique({
        where: { id: transfer.childId },
        select: { version: true },
      });
      if (!child) {
        return {
          status: SyncOperationStatus.conflict,
          conflictReason: 'Child not found for transfer update',
          entityId: context.entityId,
        };
      }
      childVersion = child.version;
    }

    try {
      if (targetStatus === TransferStatus.accepted) {
        const acceptedById = payload.acceptedById ?? payload.acceptedBy;
        if (typeof acceptedById !== 'string' || !acceptedById) {
          return {
            status: SyncOperationStatus.failed,
            conflictReason: 'acceptedById is required to accept a transfer',
            entityId: context.entityId,
          };
        }

        const result = await this.transferLifecycle.accept(db, {
          transferId: transfer.id,
          acceptedById,
          deviceId: context.deviceId,
          transferVersion,
          childVersion,
          updatedById:
            typeof payload.updatedById === 'string'
              ? payload.updatedById
              : null,
        });

        if (result.status === 'conflict') {
          return {
            status: SyncOperationStatus.conflict,
            conflictReason: result.conflictReason,
            entityId: context.entityId,
          };
        }

        return {
          status: SyncOperationStatus.applied,
          entityId: result.transfer.id,
        };
      }

      const result = await this.transferLifecycle.cancel(db, {
        transferId: transfer.id,
        deviceId: context.deviceId,
        transferVersion,
        childVersion,
        updatedById:
          typeof payload.updatedById === 'string' ? payload.updatedById : null,
      });

      if (result.status === 'conflict') {
        return {
          status: SyncOperationStatus.conflict,
          conflictReason: result.conflictReason,
          entityId: context.entityId,
        };
      }

      return {
        status: SyncOperationStatus.applied,
        entityId: result.transfer.id,
      };
    } catch (error) {
      this.logger.error(`child_transfer UPDATE failed`, error);
      return {
        status: SyncOperationStatus.failed,
        conflictReason: error instanceof Error ? error.message : 'Update failed',
        entityId: context.entityId,
      };
    }
  }

  /**
   * Referral UPDATE is restricted to status/notes (and optional implementedAt).
   * State machine: pending → completed | cancelled; terminal states reject.
   */
  private async applyReferralUpdate(context: ApplyContext) {
    const payload = context.payload;
    const db = this.db(context);

    const referral = await db.referral.findUnique({
      where: { id: context.entityId },
      select: {
        id: true,
        version: true,
        status: true,
        implementedAt: true,
        notes: true,
      },
    });

    if (!referral) {
      return {
        status: SyncOperationStatus.failed,
        conflictReason: 'Referral not found for update',
        entityId: context.entityId,
      };
    }

    if (payload.status != null) {
      let nextStatus: ReferralStatus;
      try {
        nextStatus = resolveReferralStatusFromPayload(payload);
      } catch (error) {
        return {
          status: SyncOperationStatus.failed,
          conflictReason:
            error instanceof Error ? error.message : 'Invalid referral status',
          entityId: context.entityId,
        };
      }

      if (!canTransitionReferralStatus(referral.status, nextStatus)) {
        return {
          status: SyncOperationStatus.failed,
          conflictReason: `Cannot transition referral from ${referral.status} to ${nextStatus}`,
          entityId: context.entityId,
        };
      }
    }

    try {
      const outcome = await this.casUpdate(context);
      if (outcome.kind === 'applied') {
        return { status: SyncOperationStatus.applied, entityId: context.entityId };
      }
      if (outcome.kind === 'not_found') {
        return {
          status: SyncOperationStatus.failed,
          conflictReason: 'Entity not found for update',
          entityId: context.entityId,
        };
      }
      return {
        status: SyncOperationStatus.conflict,
        conflictReason: `version mismatch: client ${context.clientVersion}, server ${outcome.serverVersion}`,
        entityId: context.entityId,
      };
    } catch (error) {
      this.logger.error(`referral UPDATE failed`, error);
      return {
        status: SyncOperationStatus.failed,
        conflictReason: error instanceof Error ? error.message : 'Update failed',
        entityId: context.entityId,
      };
    }
  }

  private async applyDelete(context: ApplyContext) {
    try {
      const outcome = await this.casSoftDelete(context);
      if (outcome.kind === 'applied') {
        return { status: SyncOperationStatus.applied, entityId: context.entityId };
      }
      if (outcome.kind === 'not_found') {
        return {
          status: SyncOperationStatus.failed,
          conflictReason: 'Entity not found for delete',
          entityId: context.entityId,
        };
      }
      return {
        status: SyncOperationStatus.conflict,
        conflictReason: `version mismatch: client ${context.clientVersion}, server ${outcome.serverVersion}`,
        entityId: context.entityId,
      };
    } catch (error) {
      this.logger.error(`DELETE failed for ${context.entityType}`, error);
      return {
        status: SyncOperationStatus.failed,
        conflictReason: error instanceof Error ? error.message : 'Delete failed',
        entityId: context.entityId,
      };
    }
  }

  /**
   * Atomic compare-and-swap update. Existence check runs only on conflict branch.
   */
  private async casUpdate(context: ApplyContext): Promise<CasOutcome> {
    const db = this.db(context);
    const now = new Date();
    const payload = context.payload;
    const where = { id: context.entityId, version: context.clientVersion };
    const meta = {
      version: { increment: 1 as const },
      syncStatus: RecordSyncStatus.synced,
      lastModifiedByDeviceId: context.deviceId,
      lastModifiedAt: now,
    };

    let count = 0;

    switch (context.entityType) {
      case 'child':
        count = (
          await db.child.updateMany({
            where,
            data: {
              ...(payload.firstName != null && {
                firstName: String(payload.firstName),
              }),
              ...(payload.middleName !== undefined && {
                middleName: (payload.middleName as string) ?? null,
              }),
              ...(payload.lastName !== undefined && {
                lastName: (payload.lastName as string) ?? null,
              }),
              ...(payload.status != null && { status: payload.status as never }),
              ...(payload.specialNeeds !== undefined && {
                specialNeeds: (payload.specialNeeds as string) ?? null,
              }),
              ...(payload.disabilityNotes !== undefined && {
                disabilityNotes: (payload.disabilityNotes as string) ?? null,
              }),
              ...(payload.guardianName != null && {
                guardianName: String(payload.guardianName),
              }),
              ...(payload.guardianPhone != null && {
                guardianPhone: String(payload.guardianPhone),
              }),
              ...(payload.guardianRelation != null && {
                guardianRelation: String(payload.guardianRelation),
              }),
              ...(payload.guardian2Name !== undefined && {
                guardian2Name: (payload.guardian2Name as string) ?? null,
              }),
              ...(payload.guardian2Phone !== undefined && {
                guardian2Phone: (payload.guardian2Phone as string) ?? null,
              }),
              ...(payload.guardian2Relation !== undefined && {
                guardian2Relation: (payload.guardian2Relation as string) ?? null,
              }),
              ...(payload.archiveReason !== undefined && {
                archiveReason: (payload.archiveReason as string) ?? null,
              }),
              ...(payload.archivedAt !== undefined && {
                archivedAt: payload.archivedAt
                  ? new Date(String(payload.archivedAt))
                  : null,
              }),
              ...meta,
            },
          })
        ).count;
        break;
      case 'attendance_record': {
        const data: Prisma.AttendanceRecordUpdateManyMutationInput = {
          ...meta,
        };

        if (typeof payload.present === 'boolean' || payload.status != null) {
          const status = resolveAttendanceStatusFromPayload(payload);
          data.status = status;
          data.absentReason = resolveAbsentReasonFromPayload(payload, status);
        } else if (payload.absentReason !== undefined) {
          data.absentReason = (payload.absentReason as never) ?? null;
        }

        if (payload.broughtBy !== undefined) {
          data.broughtBy = (payload.broughtBy as string) ?? null;
        }
        if (payload.broughtByOther !== undefined) {
          data.broughtByOther = (payload.broughtByOther as string) ?? null;
        }
        if (payload.arrivedAt !== undefined) {
          data.arrivedAt = payload.arrivedAt
            ? new Date(String(payload.arrivedAt))
            : null;
        }
        if (payload.notes !== undefined) {
          data.notes = (payload.notes as string) ?? null;
        }

        count = (
          await db.attendanceRecord.updateMany({
            where,
            data,
          })
        ).count;
        break;
      }
      case 'ecd_center':
        count = (
          await db.ecdCenter.updateMany({
            where,
            data: {
              ...(payload.name != null && { name: String(payload.name) }),
              ...(payload.phone !== undefined && {
                phone: (payload.phone as string) ?? null,
              }),
              ...(payload.capacity !== undefined && {
                capacity:
                  payload.capacity != null ? Number(payload.capacity) : null,
              }),
              ...(payload.status != null && { status: payload.status as never }),
              ...meta,
            },
          })
        ).count;
        break;
      case 'compliance_assessment':
        count = (
          await db.complianceAssessment.updateMany({
            where,
            data: {
              ...(payload.status != null && { status: payload.status as never }),
              ...(payload.overallClassification !== undefined && {
                overallClassification:
                  (payload.overallClassification as never) ?? null,
              }),
              ...(payload.submittedById !== undefined && {
                submittedById: (payload.submittedById as string) ?? null,
              }),
              ...(payload.verifiedById !== undefined && {
                verifiedById: (payload.verifiedById as string) ?? null,
              }),
              ...meta,
            },
          })
        ).count;
        break;
      case 'compliance_assessment_item':
        count = (
          await db.complianceAssessmentItem.updateMany({
            where,
            data: {
              ...(payload.response != null && {
                response: payload.response as never,
              }),
              ...(payload.score !== undefined && {
                score:
                  payload.score != null
                    ? new Prisma.Decimal(String(payload.score))
                    : null,
              }),
              ...(payload.evidenceNotes !== undefined && {
                evidenceNotes: (payload.evidenceNotes as string) ?? null,
              }),
              ...(payload.gapSeverity !== undefined && {
                gapSeverity: (payload.gapSeverity as never) ?? null,
              }),
              ...(payload.gapImprovementAction !== undefined && {
                gapImprovementAction:
                  (payload.gapImprovementAction as string) ?? null,
              }),
              ...(payload.gapStatus !== undefined && {
                gapStatus: (payload.gapStatus as never) ?? null,
              }),
              ...meta,
            },
          })
        ).count;
        break;
      case 'wash_indicator':
        count = (
          await db.washIndicator.updateMany({
            where,
            data: {
              ...(payload.waterSourceAvailable != null && {
                waterSourceAvailable: Boolean(payload.waterSourceAvailable),
              }),
              ...(payload.waterSourceType !== undefined && {
                waterSourceType: (payload.waterSourceType as string) ?? null,
              }),
              ...(payload.sanitationFacilityAvailable != null && {
                sanitationFacilityAvailable: Boolean(
                  payload.sanitationFacilityAvailable,
                ),
              }),
              ...(payload.latrineCount !== undefined && {
                latrineCount:
                  payload.latrineCount != null
                    ? Number(payload.latrineCount)
                    : null,
              }),
              ...(payload.handwashingFacilityAvailable != null && {
                handwashingFacilityAvailable: Boolean(
                  payload.handwashingFacilityAvailable,
                ),
              }),
              ...(payload.wasteManagementAvailable != null && {
                wasteManagementAvailable: Boolean(
                  payload.wasteManagementAvailable,
                ),
              }),
              ...(payload.notes !== undefined && {
                notes: (payload.notes as string) ?? null,
              }),
              ...meta,
            },
          })
        ).count;
        break;
      case 'center_feeding_day':
        count = (
          await db.centerFeedingDay.updateMany({
            where,
            data: {
              ...(payload.milkServed != null && {
                milkServed: Boolean(payload.milkServed),
              }),
              ...(payload.porridgeServed != null && {
                porridgeServed: Boolean(payload.porridgeServed),
              }),
              ...(payload.balancedMealServed != null && {
                balancedMealServed: Boolean(payload.balancedMealServed),
              }),
              ...(payload.cerealsOrTubers != null && {
                cerealsOrTubers: Boolean(payload.cerealsOrTubers),
              }),
              ...(payload.legumes != null && {
                legumes: Boolean(payload.legumes),
              }),
              ...(payload.dairy != null && { dairy: Boolean(payload.dairy) }),
              ...(payload.animalProducts != null && {
                animalProducts: Boolean(payload.animalProducts),
              }),
              ...(payload.fruitsVegetables != null && {
                fruitsVegetables: Boolean(payload.fruitsVegetables),
              }),
              ...(payload.addedFat != null && {
                addedFat: Boolean(payload.addedFat),
              }),
              ...meta,
            },
          })
        ).count;
        break;
      case 'center_feeding_month_summary':
        count = (
          await db.centerFeedingMonthSummary.updateMany({
            where,
            data: {
              ...(payload.milkLiters != null && {
                milkLiters: new Prisma.Decimal(String(payload.milkLiters)),
              }),
              ...(payload.flourKg != null && {
                flourKg: new Prisma.Decimal(String(payload.flourKg)),
              }),
              ...(payload.foodSource != null && {
                foodSource: String(payload.foodSource),
              }),
              ...(payload.updatedById !== undefined && {
                updatedById: (payload.updatedById as string) ?? null,
              }),
              ...meta,
            },
          })
        ).count;
        break;
      case 'referral': {
        // Status/notes only (implementedAt allowed with status transitions)
        const data: Prisma.ReferralUpdateManyMutationInput = { ...meta };
        let nextStatus: ReferralStatus | undefined;
        if (payload.status != null) {
          nextStatus = resolveReferralStatusFromPayload(payload);
          data.status = nextStatus;
        }
        if (payload.notes !== undefined) {
          data.notes = (payload.notes as string) ?? null;
        }
        if (payload.implementedAt !== undefined) {
          data.implementedAt = payload.implementedAt
            ? new Date(String(payload.implementedAt))
            : null;
        } else if (nextStatus === ReferralStatus.completed) {
          data.implementedAt = now;
        }
        count = (await db.referral.updateMany({ where, data })).count;
        break;
      }
      default:
        throw new Error(`Unsupported entity type for CAS update: ${context.entityType}`);
    }

    if (count === 1) {
      return { kind: 'applied' };
    }

    return this.classifyCasMiss(context);
  }

  private async casSoftDelete(context: ApplyContext): Promise<CasOutcome> {
    const db = this.db(context);
    const now = new Date();
    const where = { id: context.entityId, version: context.clientVersion };
    const data = {
      deletedAt: now,
      version: { increment: 1 as const },
      syncStatus: RecordSyncStatus.synced,
      lastModifiedByDeviceId: context.deviceId,
      lastModifiedAt: now,
    };

    let count = 0;

    switch (context.entityType) {
      case 'child':
        count = (await db.child.updateMany({ where, data })).count;
        break;
      case 'attendance_record':
        count = (await db.attendanceRecord.updateMany({ where, data })).count;
        break;
      case 'child_nutrition_screening':
        count = (
          await db.childNutritionScreening.updateMany({ where, data })
        ).count;
        break;
      case 'sted_assessment':
        count = (await db.stedAssessment.updateMany({ where, data })).count;
        break;
      case 'child_transfer':
        count = (await db.childTransfer.updateMany({ where, data })).count;
        break;
      case 'ecd_center':
        count = (await db.ecdCenter.updateMany({ where, data })).count;
        break;
      case 'compliance_assessment':
        count = (
          await db.complianceAssessment.updateMany({ where, data })
        ).count;
        break;
      case 'compliance_assessment_item':
        count = (
          await db.complianceAssessmentItem.updateMany({ where, data })
        ).count;
        break;
      case 'wash_indicator':
        count = (await db.washIndicator.updateMany({ where, data })).count;
        break;
      case 'center_feeding_day':
        count = (await db.centerFeedingDay.updateMany({ where, data })).count;
        break;
      case 'center_feeding_month_summary':
        count = (
          await db.centerFeedingMonthSummary.updateMany({ where, data })
        ).count;
        break;
      case 'referral':
        count = (await db.referral.updateMany({ where, data })).count;
        break;
      default:
        throw new Error(`Unsupported entity type for CAS delete: ${context.entityType}`);
    }

    if (count === 1) {
      return { kind: 'applied' };
    }

    return this.classifyCasMiss(context);
  }

  /** Cheap existence check only on the conflict/miss branch. */
  private async classifyCasMiss(context: ApplyContext): Promise<CasOutcome> {
    const existing = await this.findRecord(
      context.entityType,
      context.entityId,
      context,
    );
    if (!existing) {
      return { kind: 'not_found' };
    }
    return { kind: 'version_mismatch', serverVersion: existing.version };
  }

  private async findRecord(
    entityType: SyncableEntityType,
    entityId: string,
    context?: ApplyContext,
  ): Promise<{ version: number } | null> {
    const db = context ? this.db(context) : this.prisma;

    switch (entityType) {
      case 'child':
        return db.child.findUnique({
          where: { id: entityId },
          select: { version: true },
        });
      case 'attendance_record':
        return db.attendanceRecord.findUnique({
          where: { id: entityId },
          select: { version: true },
        });
      case 'child_nutrition_screening':
        return db.childNutritionScreening.findUnique({
          where: { id: entityId },
          select: { version: true },
        });
      case 'sted_assessment':
        return db.stedAssessment.findUnique({
          where: { id: entityId },
          select: { version: true },
        });
      case 'child_transfer':
        return db.childTransfer.findUnique({
          where: { id: entityId },
          select: { version: true },
        });
      case 'ecd_center':
        return db.ecdCenter.findUnique({
          where: { id: entityId },
          select: { version: true },
        });
      case 'compliance_assessment':
        return db.complianceAssessment.findUnique({
          where: { id: entityId },
          select: { version: true },
        });
      case 'compliance_assessment_item':
        return db.complianceAssessmentItem.findUnique({
          where: { id: entityId },
          select: { version: true },
        });
      case 'wash_indicator':
        return db.washIndicator.findUnique({
          where: { id: entityId },
          select: { version: true },
        });
      case 'center_feeding_day':
        return db.centerFeedingDay.findUnique({
          where: { id: entityId },
          select: { version: true },
        });
      case 'center_feeding_month_summary':
        return db.centerFeedingMonthSummary.findUnique({
          where: { id: entityId },
          select: { version: true },
        });
      case 'referral':
        return db.referral.findUnique({
          where: { id: entityId },
          select: { version: true },
        });
      default:
        return null;
    }
  }

  private syncMeta(deviceId: string, nextVersion: number) {
    return {
      version: nextVersion,
      syncStatus: RecordSyncStatus.synced,
      lastModifiedByDeviceId: deviceId,
      lastModifiedAt: new Date(),
    };
  }

  private async createRecord(context: ApplyContext): Promise<void> {
    const id = context.entityId || randomUUID();
    const payload = context.payload;
    const meta = this.syncMeta(
      context.deviceId,
      Math.max(1, context.clientVersion || 1),
    );
    const db = this.db(context);

    switch (context.entityType) {
      case 'child':
        await db.child.create({
          data: {
            id,
            nationalId: String(payload.nationalId),
            firstName: String(payload.firstName),
            middleName: (payload.middleName as string) ?? null,
            lastName: (payload.lastName as string) ?? null,
            centerId: String(payload.centerId),
            dateOfBirth: new Date(String(payload.dateOfBirth)),
            gender: resolveChildGenderFromPayload(payload),
            status: (payload.status as never) ?? undefined,
            specialNeeds: (payload.specialNeeds as string) ?? null,
            disabilityNotes: (payload.disabilityNotes as string) ?? null,
            guardianName: String(payload.guardianName),
            guardianPhone: String(payload.guardianPhone),
            guardianRelation: String(payload.guardianRelation),
            guardian2Name: (payload.guardian2Name as string) ?? null,
            guardian2Phone: (payload.guardian2Phone as string) ?? null,
            guardian2Relation: (payload.guardian2Relation as string) ?? null,
            homeVillageId: String(payload.homeVillageId),
            registeredAt: new Date(String(payload.registeredAt)),
            archiveReason: (payload.archiveReason as string) ?? null,
            archivedAt: payload.archivedAt
              ? new Date(String(payload.archivedAt))
              : null,
            ...meta,
          },
        });
        break;
      case 'attendance_record': {
        const status = resolveAttendanceStatusFromPayload(payload);
        const absentReason = resolveAbsentReasonFromPayload(payload, status);
        let centerId =
          typeof payload.centerId === 'string' ? payload.centerId : null;
        if (!centerId) {
          const child = await db.child.findUnique({
            where: { id: String(payload.childId) },
            select: { centerId: true },
          });
          centerId = child?.centerId ?? null;
        }
        if (!centerId) {
          throw new Error(
            'attendance_record requires centerId or a valid childId',
          );
        }

        const attendanceDateRaw =
          payload.attendanceDate ?? payload.date ?? null;
        if (attendanceDateRaw == null) {
          throw new Error(
            'attendance_record requires attendanceDate (or date)',
          );
        }

        await db.attendanceRecord.create({
          data: {
            id,
            childId: String(payload.childId),
            centerId,
            attendanceDate: new Date(String(attendanceDateRaw)),
            status,
            broughtBy: (payload.broughtBy as string) ?? null,
            broughtByOther: (payload.broughtByOther as string) ?? null,
            arrivedAt: payload.arrivedAt
              ? new Date(String(payload.arrivedAt))
              : null,
            absentReason,
            notes: (payload.notes as string) ?? null,
            recordedById: String(payload.recordedById ?? payload.recordedBy),
            ...meta,
            lastModifiedByDeviceId:
              typeof payload.deviceId === 'string'
                ? payload.deviceId
                : meta.lastModifiedByDeviceId,
          },
        });
        break;
      }
      case 'child_nutrition_screening': {
        // Append-only CREATE: no CAS
        const nutritionStatus = payload.nutritionStatus as never;
        const requiresReferral = deriveRequiresReferral(
          nutritionStatus,
          payload.requiresReferral != null
            ? Boolean(payload.requiresReferral)
            : undefined,
        );

        await db.childNutritionScreening.create({
          data: {
            id,
            childId: String(payload.childId),
            screeningDate: new Date(String(payload.screeningDate)),
            weightKg: new Prisma.Decimal(String(payload.weightKg)),
            muacCm: new Prisma.Decimal(String(payload.muacCm)),
            heightCm:
              payload.heightCm != null
                ? new Prisma.Decimal(String(payload.heightCm))
                : null,
            headCircumferenceCm:
              payload.headCircumferenceCm != null
                ? new Prisma.Decimal(String(payload.headCircumferenceCm))
                : null,
            nutritionStatus,
            requiresReferral,
            mealQuality: (payload.mealQuality as string) ?? null,
            feedingConcern: Boolean(payload.feedingConcern ?? false),
            dietNotes: (payload.dietNotes as string) ?? null,
            recordedById: String(payload.recordedById ?? payload.recordedBy),
            ...meta,
            lastModifiedByDeviceId:
              typeof payload.deviceId === 'string'
                ? payload.deviceId
                : meta.lastModifiedByDeviceId,
          },
        });
        break;
      }
      case 'sted_assessment': {
        // Append-only CREATE: UPDATE is rejected; duplicate id → conflict upstream
        const ageBand = resolveStedAgeBandFromPayload(payload);
        let centerId =
          typeof payload.centerId === 'string' ? payload.centerId : null;
        if (!centerId) {
          const child = await db.child.findUnique({
            where: { id: String(payload.childId) },
            select: { centerId: true },
          });
          centerId = child?.centerId ?? null;
        }
        if (!centerId) {
          throw new Error(
            'sted_assessment requires centerId or a valid childId',
          );
        }

        await db.stedAssessment.create({
          data: {
            id,
            childId: String(payload.childId),
            centerId,
            assessmentDate: new Date(String(payload.assessmentDate)),
            ageBand,
            consentObtained: Boolean(payload.consentObtained ?? false),
            physicalAssessment: (payload.physicalAssessment ??
              {}) as Prisma.InputJsonValue,
            milestoneResults: (payload.milestoneResults ??
              {}) as Prisma.InputJsonValue,
            outcome: (payload.outcome ?? {}) as Prisma.InputJsonValue,
            followUpIn6Months: Boolean(payload.followUpIn6Months ?? false),
            followUpDueDate: payload.followUpDueDate
              ? new Date(String(payload.followUpDueDate))
              : null,
            notes: (payload.notes as string) ?? null,
            assessedById: String(
              payload.assessedById ?? payload.assessedBy ?? payload.recordedById,
            ),
            ...meta,
            lastModifiedByDeviceId:
              typeof payload.deviceId === 'string'
                ? payload.deviceId
                : meta.lastModifiedByDeviceId,
          },
        });
        break;
      }
      case 'ecd_center':
        await db.ecdCenter.create({
          data: {
            id,
            districtId: String(payload.districtId),
            villageId: String(payload.villageId),
            code: String(payload.code),
            name: String(payload.name),
            phone: (payload.phone as string) ?? null,
            capacity: payload.capacity != null ? Number(payload.capacity) : null,
            latitude:
              payload.latitude != null
                ? new Prisma.Decimal(String(payload.latitude))
                : null,
            longitude:
              payload.longitude != null
                ? new Prisma.Decimal(String(payload.longitude))
                : null,
            status: (payload.status as never) ?? undefined,
            ...meta,
          },
        });
        break;
      case 'compliance_assessment':
        await db.complianceAssessment.create({
          data: {
            id,
            centerId: String(payload.centerId),
            standardsVersion: String(payload.standardsVersion),
            assessmentType: payload.assessmentType as never,
            assessmentDate: new Date(String(payload.assessmentDate)),
            status: (payload.status as never) ?? undefined,
            submittedById: (payload.submittedById as string) ?? null,
            verifiedById: (payload.verifiedById as string) ?? null,
            overallClassification:
              (payload.overallClassification as never) ?? null,
            ...meta,
          },
        });
        break;
      case 'compliance_assessment_item':
        await db.complianceAssessmentItem.create({
          data: {
            id,
            assessmentId: String(payload.assessmentId),
            standardId: String(payload.standardId),
            response: payload.response as never,
            score:
              payload.score != null
                ? new Prisma.Decimal(String(payload.score))
                : null,
            evidenceNotes: (payload.evidenceNotes as string) ?? null,
            gapSeverity: (payload.gapSeverity as never) ?? null,
            gapImprovementAction:
              (payload.gapImprovementAction as string) ?? null,
            gapTargetDate: payload.gapTargetDate
              ? new Date(String(payload.gapTargetDate))
              : null,
            gapStatus: (payload.gapStatus as never) ?? null,
            gapResolvedAt: payload.gapResolvedAt
              ? new Date(String(payload.gapResolvedAt))
              : null,
            ...meta,
          },
        });
        break;
      case 'wash_indicator':
        await db.washIndicator.create({
          data: {
            id,
            centerId: String(payload.centerId),
            recordedDate: new Date(String(payload.recordedDate)),
            waterSourceAvailable: Boolean(payload.waterSourceAvailable ?? false),
            waterSourceType: (payload.waterSourceType as string) ?? null,
            sanitationFacilityAvailable: Boolean(
              payload.sanitationFacilityAvailable ?? false,
            ),
            latrineCount:
              payload.latrineCount != null ? Number(payload.latrineCount) : null,
            handwashingFacilityAvailable: Boolean(
              payload.handwashingFacilityAvailable ?? false,
            ),
            wasteManagementAvailable: Boolean(
              payload.wasteManagementAvailable ?? false,
            ),
            notes: (payload.notes as string) ?? null,
            recordedById: String(payload.recordedById ?? payload.recordedBy),
            ...meta,
          },
        });
        break;
      case 'child_transfer':
        throw new Error('child_transfer create must use applyChildTransferCreate');
      case 'referral': {
        let centerId =
          typeof payload.centerId === 'string' ? payload.centerId : null;
        if (!centerId) {
          const child = await db.child.findUnique({
            where: { id: String(payload.childId) },
            select: { centerId: true },
          });
          centerId = child?.centerId ?? null;
        }
        if (!centerId) {
          throw new Error('referral requires centerId or a valid childId');
        }

        const sourceType = resolveReferralSourceTypeFromPayload(payload);
        const status =
          payload.status != null
            ? resolveReferralStatusFromPayload(payload)
            : ReferralStatus.pending;
        // Validate before Prisma create so missing/alias-only recordedBy
        // becomes a terminal failed op — not String(undefined) → P2003 retry loop.
        const recordedById = resolveReferralRecordedByIdFromPayload(payload);
        const recorder = await db.userAccount.findUnique({
          where: { id: recordedById },
          select: { id: true },
        });
        if (!recorder) {
          throw new Error(
            'referral recordedById does not reference an existing user',
          );
        }

        await db.referral.create({
          data: {
            id,
            childId: String(payload.childId),
            centerId,
            sourceType,
            sourceId: String(payload.sourceId),
            referralDate: new Date(String(payload.referralDate)),
            reason: String(payload.reason),
            destination: String(payload.destination),
            status,
            implementedAt: payload.implementedAt
              ? new Date(String(payload.implementedAt))
              : null,
            notes: (payload.notes as string) ?? null,
            recordedById,
            ...meta,
            lastModifiedByDeviceId:
              typeof payload.deviceId === 'string'
                ? payload.deviceId
                : meta.lastModifiedByDeviceId,
          },
        });
        break;
      }
      default:
        throw new Error(`Unsupported entity type: ${context.entityType}`);
    }
  }
}

const RETRYABLE_PRISMA_CODES = new Set([
  'P1001',
  'P1002',
  'P1008',
  'P1017',
  'P2024',
  'P2034',
  'P2003',
]);

export function isRetryableApplyError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return RETRYABLE_PRISMA_CODES.has(error.code);
  }
  if (error instanceof Prisma.PrismaClientInitializationError) {
    return true;
  }
  if (error instanceof Prisma.PrismaClientRustPanicError) {
    return true;
  }
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  return (
    message.includes('timeout') ||
    message.includes('econnrefused') ||
    message.includes('connection') ||
    message.includes('too many clients') ||
    message.includes('could not serialize')
  );
}

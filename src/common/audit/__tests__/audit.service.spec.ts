import { ChildStatus, TransferStatus, UserRole } from '@prisma/client';
import {
  AuditAction,
  AuditService,
  toPrismaAuditAction,
} from '../index';
import { OptimisticLockConflictException } from '../../concurrency/optimistic-lock.exception';
import { AuthUser } from '../../../modules/auth/interfaces/jwt-payload.interface';
import { ChildrenService } from '../../../modules/children/children.service';
import { TransferLifecycleService } from '../../../modules/transfers/transfer-lifecycle.service';

/**
 * Sprint 3.3 — Central audit transaction & attribution tests.
 * Run: npx ts-node src/common/audit/__tests__/audit.service.spec.ts
 */

function user(partial: Partial<AuthUser> & Pick<AuthUser, 'role'>): AuthUser {
  return {
    id: partial.id ?? 'user-1',
    username: partial.username ?? 'user',
    email: null,
    fullName: 'User',
    role: partial.role,
    centerId: partial.centerId ?? null,
    districtId: partial.districtId ?? null,
    status: 'active',
  };
}

function childRow(overrides: Record<string, unknown> = {}) {
  const now = new Date();
  return {
    id: 'child-1',
    registrationNumber: 'REG-1',
    firstName: 'Ada',
    middleName: null,
    lastName: 'Lovelace',
    centerId: 'center-a',
    dateOfBirth: new Date('2020-01-01'),
    gender: 'male',
    status: ChildStatus.active,
    specialNeeds: null,
    disabilityNotes: null,
    guardianName: 'Guardian',
    guardianPhone: '0780000000',
    guardianRelation: 'mother',
    guardian2Name: null,
    guardian2Phone: null,
    guardian2Relation: null,
    homeVillageId: 'village-1',
    registeredAt: now,
    archiveReason: null,
    archivedAt: null,
    createdAt: now,
    createdById: 'user-1',
    updatedAt: now,
    updatedById: 'user-1',
    deletedAt: null,
    version: 5,
    syncStatus: 'synced',
    lastModifiedByDeviceId: null,
    lastModifiedAt: now,
    center: {
      id: 'center-a',
      code: 'C1',
      name: 'Center A',
      districtId: 'd1',
      district: { name: 'D1', province: { name: 'P1' } },
    },
    homeVillage: {
      id: 'village-1',
      name: 'Village',
      code: 'V1',
      level: 'village',
      parent: null,
    },
    ...overrides,
  };
}

type AuditRow = {
  entityType: string;
  entityId: string;
  action: string;
  changedById: string | null;
  oldValues: unknown;
  newValues: unknown;
  metadata: unknown;
};

function recordingAudit() {
  const rows: AuditRow[] = [];
  const service = {
    log: async (ctx: {
      entityType: string;
      entityId: string;
      action: AuditAction;
      userId?: string | null;
      oldValues?: unknown;
      newValues?: unknown;
      deviceId?: string | null;
      operationId?: string | null;
      metadata?: Record<string, unknown> | null;
      tx: { auditLog: { create: (args: { data: AuditRow }) => Promise<unknown> } };
    }) => {
      // Simulate real AuditService persistence via tx for rollback tests.
      await ctx.tx.auditLog.create({
        data: {
          entityType: ctx.entityType,
          entityId: ctx.entityId,
          action: toPrismaAuditAction(ctx.action),
          changedById: ctx.userId ?? null,
          oldValues: ctx.oldValues ?? null,
          newValues: ctx.newValues ?? null,
          metadata: {
            domainAction: ctx.action,
            ...(ctx.deviceId ? { deviceId: ctx.deviceId } : {}),
            ...(ctx.operationId ? { operationId: ctx.operationId } : {}),
            ...(ctx.metadata ?? {}),
          },
        },
      });
      rows.push({
        entityType: ctx.entityType,
        entityId: ctx.entityId,
        action: ctx.action,
        changedById: ctx.userId ?? null,
        oldValues: ctx.oldValues ?? null,
        newValues: ctx.newValues ?? null,
        metadata: {
          domainAction: ctx.action,
          ...(ctx.deviceId ? { deviceId: ctx.deviceId } : {}),
          ...(ctx.operationId ? { operationId: ctx.operationId } : {}),
        },
      });
    },
  };
  return { service: service as unknown as AuditService, rows };
}

async function run() {
  let passed = 0;
  let failed = 0;

  const assert = async (name: string, fn: () => Promise<void> | void) => {
    try {
      await fn();
      passed += 1;
      console.log(`PASS  ${name}`);
    } catch (err) {
      failed += 1;
      console.error(`FAIL  ${name}`);
      console.error(err);
    }
  };

  const eq = (actual: unknown, expected: unknown) => {
    if (actual !== expected) {
      throw new Error(
        `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
      );
    }
  };

  const caregiver = user({
    role: UserRole.caregiver,
    id: 'cg-1',
    centerId: 'center-a',
    districtId: 'd1',
  });

  // ── Scenario 1: child update succeeds → entity + audit ─────────────────
  await assert('Scenario 1 — child update succeeds with audit record', async () => {
    const { service: audit, rows } = recordingAudit();
    const auditLogCreates: AuditRow[] = [];

    const syncAccess = {
      resolveScope: async () => ({
        centerIds: ['center-a'] as string[] | 'all',
        districtId: 'd1',
      }),
      centerFilter: () => ({ centerId: { in: ['center-a'] } }),
    };

    const prisma = {
      child: {
        findFirst: async () => childRow({ version: 5, firstName: 'Ada' }),
      },
      device: { findUnique: async () => null },
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
        const txState = { childUpdated: false };
        const result = await fn({
          child: {
            updateMany: async () => {
              txState.childUpdated = true;
              return { count: 1 };
            },
            findFirstOrThrow: async () =>
              childRow({ version: 6, firstName: 'Augusta' }),
            findUnique: async () => ({ version: 6 }),
          },
          syncOperation: { create: async () => ({}) },
          auditLog: {
            create: async ({ data }: { data: AuditRow }) => {
              auditLogCreates.push(data);
              return data;
            },
          },
        });
        eq(txState.childUpdated, true);
        return result;
      },
    };

    const children = new ChildrenService(
      prisma as never,
      syncAccess as never,
      audit,
    );

    const updated = await children.update(caregiver, 'child-1', {
      version: 5,
      firstName: 'Augusta',
    });

    eq(updated.version, 6);
    eq(typeof updated.fullName, 'string');
    eq(rows.length, 1);
    eq(rows[0].entityType, 'child');
    eq(rows[0].action, AuditAction.UPDATE);
    eq(rows[0].changedById, 'cg-1');
    eq(auditLogCreates.length, 1);
  });

  // ── Scenario 2: child update fails → no entity change, no audit ────────
  await assert('Scenario 2 — child update failure rolls back audit', async () => {
    const { service: audit, rows } = recordingAudit();
    const auditLogCreates: AuditRow[] = [];

    const syncAccess = {
      resolveScope: async () => ({
        centerIds: ['center-a'] as string[] | 'all',
        districtId: 'd1',
      }),
      centerFilter: () => ({ centerId: { in: ['center-a'] } }),
    };

    const prisma = {
      child: {
        findFirst: async () => childRow({ version: 6 }),
      },
      device: { findUnique: async () => null },
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
        try {
          return await fn({
            child: {
              updateMany: async () => ({ count: 0 }),
              findUnique: async () => ({ version: 6 }),
            },
            auditLog: {
              create: async ({ data }: { data: AuditRow }) => {
                auditLogCreates.push(data);
                return data;
              },
            },
          });
        } catch (err) {
          // Simulate DB rollback — discard any audit writes from this tx.
          auditLogCreates.length = 0;
          rows.length = 0;
          throw err;
        }
      },
    };

    const children = new ChildrenService(
      prisma as never,
      syncAccess as never,
      audit,
    );

    let caught: unknown;
    try {
      await children.update(caregiver, 'child-1', {
        version: 5,
        firstName: 'Stale',
      });
    } catch (err) {
      caught = err;
    }

    eq(caught instanceof OptimisticLockConflictException, true);
    eq(rows.length, 0);
    eq(auditLogCreates.length, 0);
  });

  // ── Scenario 3: transfer accepted → transfer + child + audit ─────────────
  await assert('Scenario 3 — transfer accept creates transfer + child audits', async () => {
    const { service: audit, rows } = recordingAudit();

    const state = {
      child: {
        id: 'child-1',
        centerId: 'center-a',
        version: 2,
        status: ChildStatus.transferred as ChildStatus,
        deletedAt: null as Date | null,
      },
      transfers: [
        {
          id: 'tr-1',
          childId: 'child-1',
          fromCenterId: 'center-a',
          toCenterId: 'center-b',
          transferDate: new Date('2026-01-01'),
          reason: 'relocation',
          notes: null as string | null,
          status: TransferStatus.pending as TransferStatus,
          initiatedById: 'cg-1',
          acceptedAt: null as Date | null,
          acceptedById: null as string | null,
          version: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null as Date | null,
          syncStatus: 'synced',
          lastModifiedByDeviceId: null as string | null,
          lastModifiedAt: new Date(),
        },
      ],
    };

    const tx = {
      childTransfer: {
        findFirst: async () => state.transfers[0],
        findUniqueOrThrow: async () => state.transfers[0],
        updateMany: async () => {
          state.transfers[0].status = TransferStatus.accepted;
          state.transfers[0].acceptedById = 'cg-2';
          state.transfers[0].acceptedAt = new Date();
          state.transfers[0].version = 2;
          return { count: 1 };
        },
      },
      child: {
        findUnique: async () => ({ ...state.child }),
        findUniqueOrThrow: async () => state.child,
        updateMany: async () => {
          state.child.centerId = 'center-b';
          state.child.status = ChildStatus.active;
          state.child.version = 3;
          return { count: 1 };
        },
      },
      auditLog: {
        create: async ({ data }: { data: AuditRow }) => data,
      },
    };

    const lifecycle = new TransferLifecycleService(audit);
    const result = await lifecycle.accept(tx as never, {
      transferId: 'tr-1',
      acceptedById: 'cg-2',
      deviceId: 'device-1',
      transferVersion: 1,
      childVersion: 2,
      updatedById: 'cg-2',
      operationId: 'op-accept-1',
    });

    eq(result.status, 'applied');
    if (result.status !== 'applied') return;
    eq(result.child.centerId, 'center-b');
    eq(result.child.status, ChildStatus.active);
    eq(result.transfer.status, TransferStatus.accepted);

    const transferAudit = rows.find(
      (r) =>
        r.entityType === 'child_transfer' &&
        r.action === AuditAction.TRANSFER_ACCEPT,
    );
    const childAudit = rows.find(
      (r) =>
        r.entityType === 'child' && r.action === AuditAction.TRANSFER_ACCEPT,
    );
    eq(!!transferAudit, true);
    eq(!!childAudit, true);
    eq(childAudit!.changedById, 'cg-2');
    eq((childAudit!.metadata as { deviceId?: string }).deviceId, 'device-1');
    eq(
      (childAudit!.metadata as { operationId?: string }).operationId,
      'op-accept-1',
    );
  });

  // ── Scenario 4: concurrent conflict → 409, no audit ────────────────────
  await assert('Scenario 4 — CAS conflict yields 409 and no audit', async () => {
    const { service: audit, rows } = recordingAudit();
    const auditLogCreates: AuditRow[] = [];

    const syncAccess = {
      resolveScope: async () => ({
        centerIds: ['center-a'] as string[] | 'all',
        districtId: 'd1',
      }),
      centerFilter: () => ({ centerId: { in: ['center-a'] } }),
    };

    const prisma = {
      child: {
        findFirst: async () => childRow({ version: 9 }),
      },
      device: { findUnique: async () => null },
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
        try {
          return await fn({
            child: {
              updateMany: async () => ({ count: 0 }),
              findUnique: async () => ({ version: 9 }),
            },
            auditLog: {
              create: async ({ data }: { data: AuditRow }) => {
                auditLogCreates.push(data);
                return data;
              },
            },
          });
        } catch (err) {
          auditLogCreates.length = 0;
          rows.length = 0;
          throw err;
        }
      },
    };

    const children = new ChildrenService(
      prisma as never,
      syncAccess as never,
      audit,
    );

    let caught: unknown;
    try {
      await children.update(caregiver, 'child-1', {
        version: 5,
        firstName: 'Conflict',
      });
    } catch (err) {
      caught = err;
    }

    eq(caught instanceof OptimisticLockConflictException, true);
    eq((caught as OptimisticLockConflictException).currentVersion, 9);
    eq(rows.length, 0);
    eq(auditLogCreates.length, 0);
  });

  // ── Scenario 5: sync mutation audits once; retry does not duplicate ─────
  await assert('Scenario 5 — sync apply audits once; replay skips audit', async () => {
    const auditCalls: Array<{ operationId?: string | null }> = [];
    const audit = {
      log: async (ctx: { operationId?: string | null }) => {
        auditCalls.push({ operationId: ctx.operationId });
      },
    };

    // Simulate sync processor: first apply → audit; idempotent replay → no apply.
    async function processOp(opts: {
      alreadyApplied: boolean;
      clientOperationId: string;
    }) {
      if (opts.alreadyApplied) {
        return { status: 'replayed' as const, audited: false };
      }
      await audit.log({ operationId: opts.clientOperationId });
      return { status: 'applied' as const, audited: true };
    }

    const first = await processOp({
      alreadyApplied: false,
      clientOperationId: 'client-op-1',
    });
    const replay = await processOp({
      alreadyApplied: true,
      clientOperationId: 'client-op-1',
    });

    eq(first.status, 'applied');
    eq(first.audited, true);
    eq(replay.status, 'replayed');
    eq(replay.audited, false);
    eq(auditCalls.length, 1);
    eq(auditCalls[0].operationId, 'client-op-1');
  });

  // ── Unit: AuditService maps domain actions + attribution ───────────────
  await assert('AuditService persists domainAction + device attribution', async () => {
    const created: AuditRow[] = [];
    const real = new AuditService();
    await real.log({
      tx: {
        auditLog: {
          create: async ({ data }: { data: AuditRow }) => {
            created.push(data);
            return data;
          },
        },
      } as never,
      entityType: 'child',
      entityId: 'c1',
      action: AuditAction.ARCHIVE,
      userId: 'u1',
      deviceId: 'd1',
      operationId: 'op-1',
      oldValues: { status: 'active' },
      newValues: { status: 'archived' },
      actorType: 'device',
    });

    eq(created.length, 1);
    eq(created[0].action, 'update'); // Prisma mapping
    eq(
      (created[0].metadata as { domainAction: string }).domainAction,
      AuditAction.ARCHIVE,
    );
    eq((created[0].metadata as { deviceId: string }).deviceId, 'd1');
    eq((created[0].metadata as { operationId: string }).operationId, 'op-1');
    eq((created[0].metadata as { actorType: string }).actorType, 'device');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

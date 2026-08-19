import { ConflictException, NotFoundException } from '@nestjs/common';
import { ChildStatus, UserRole } from '@prisma/client';
import {
  assertCasApplied,
  classifyCasMiss,
} from '../../../common/concurrency/cas.util';
import { OptimisticLockConflictException } from '../../../common/concurrency/optimistic-lock.exception';
import { AuthUser } from '../../auth/interfaces/jwt-payload.interface';
import { ChildrenService } from '../children.service';

/**
 * Children REST optimistic locking tests.
 * Run: npx ts-node src/modules/children/__tests__/children.optimistic-lock.spec.ts
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
    nationalId: 'REG-1',
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

function createService(prisma: object) {
  const syncAccess = {
    resolveScope: async () => ({
      centerIds: ['center-a'] as string[] | 'all',
      districtId: 'd1',
    }),
    centerFilter: () => ({ centerId: { in: ['center-a'] } }),
  };
  const mockNotifications = {
    findUserIdsByRoleAndCenter: async () => [],
    findUserIdsByRoleAndDistrict: async () => [],
    notifyAsync: () => {},
    create: async () => ({}),
    createForMultipleUsers: async () => 0,
  } as any;
  return new ChildrenService(prisma as never, syncAccess as never, {
    log: async () => {},
  } as never, mockNotifications);
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

  await assert('assertCasApplied succeeds when count=1', async () => {
    await assertCasApplied(1, 'child', async () => ({ version: 5 }));
  });

  await assert('assertCasApplied throws 409 on version miss', async () => {
    let caught: unknown;
    try {
      await assertCasApplied(0, 'child', async () => ({ version: 8 }));
    } catch (err) {
      caught = err;
    }
    eq(caught instanceof OptimisticLockConflictException, true);
    eq(caught instanceof ConflictException, true);
    eq((caught as OptimisticLockConflictException).currentVersion, 8);
    eq((caught as OptimisticLockConflictException).entity, 'child');
  });

  await assert('assertCasApplied throws 404 when missing', async () => {
    let caught: unknown;
    try {
      await assertCasApplied(0, 'child', async () => null);
    } catch (err) {
      caught = err;
    }
    eq(caught instanceof NotFoundException, true);
  });

  await assert('classifyCasMiss concurrent: one applied one mismatch', async () => {
    const first = await classifyCasMiss(1, async () => ({ version: 6 }));
    const second = await classifyCasMiss(0, async () => ({ version: 6 }));
    eq(first.kind, 'applied');
    eq(second.kind, 'version_mismatch');
    if (second.kind === 'version_mismatch') {
      eq(second.serverVersion, 6);
    }
  });

  await assert('Scenario 1 — successful child update increments version', async () => {
    let casWhere: { id?: string; version?: number } = {};
    const prisma = {
      child: {
        findFirst: async () => childRow({ version: 5 }),
      },
      device: { findUnique: async () => null },
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          child: {
            updateMany: async ({
              where,
            }: {
              where: { id: string; version: number };
            }) => {
              casWhere = where;
              return { count: 1 };
            },
            findFirstOrThrow: async () => childRow({ version: 6, firstName: 'Ada' }),
            findUnique: async () => ({ version: 6 }),
          },
          syncOperation: { create: async () => ({}) },
        }),
    };

    const result = await createService(prisma).update(caregiver, 'child-1', {
      version: 5,
      firstName: 'Ada',
    });

    eq(casWhere.version, 5);
    eq(result.version, 6);
  });

  await assert('Scenario 2 — stale child update returns 409', async () => {
    const prisma = {
      child: {
        findFirst: async () => childRow({ version: 6 }),
      },
      device: { findUnique: async () => null },
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          child: {
            updateMany: async () => ({ count: 0 }),
            findUnique: async () => ({ version: 6 }),
          },
        }),
    };

    let caught: unknown;
    try {
      await createService(prisma).update(caregiver, 'child-1', {
        version: 5,
        firstName: 'Stale',
      });
    } catch (err) {
      caught = err;
    }
    eq(caught instanceof OptimisticLockConflictException, true);
    eq((caught as OptimisticLockConflictException).currentVersion, 6);
  });

  await assert('Scenario 3 — concurrent archives: one wins one conflicts', async () => {
    let attempts = 0;
    const prisma = {
      child: {
        findFirst: async () => childRow({ version: 5 }),
      },
      device: { findUnique: async () => null },
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          child: {
            updateMany: async () => {
              attempts += 1;
              return { count: attempts === 1 ? 1 : 0 };
            },
            findFirstOrThrow: async () =>
              childRow({
                version: 6,
                status: ChildStatus.archived,
                archivedAt: new Date(),
              }),
            findUnique: async () => ({ version: 6 }),
          },
          syncOperation: { create: async () => ({}) },
        }),
    };

    const svc = createService(prisma);
    const first = await svc.archive(caregiver, 'child-1', {
      version: 5,
      archiveReason: 'moved',
    });
    eq(first.version, 6);

    let caught: unknown;
    try {
      await svc.archive(caregiver, 'child-1', {
        version: 5,
        archiveReason: 'other',
      });
    } catch (err) {
      caught = err;
    }
    eq(caught instanceof OptimisticLockConflictException, true);
  });

  await assert('archive / reactivate / softDelete use CAS where version', async () => {
    const seen: Array<{ version?: number }> = [];
    const prisma = {
      child: {
        findFirst: async () =>
          childRow({ version: 3, status: ChildStatus.archived }),
      },
      device: { findUnique: async () => null },
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          child: {
            updateMany: async ({
              where,
            }: {
              where: { version: number };
            }) => {
              seen.push(where);
              return { count: 1 };
            },
            findFirstOrThrow: async () =>
              childRow({ version: 4, status: ChildStatus.active }),
            findUnique: async () => ({ version: 4 }),
          },
          syncOperation: { create: async () => ({}) },
        }),
    };

    const svc = createService(prisma);
    await svc.reactivate(caregiver, 'child-1', { version: 3 });
    eq(seen[0]?.version, 3);

    const deletePrisma = {
      child: {
        findFirst: async () => childRow({ version: 4 }),
      },
      device: { findUnique: async () => null },
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          child: {
            updateMany: async ({
              where,
            }: {
              where: { version: number };
            }) => {
              seen.push(where);
              return { count: 1 };
            },
            findFirstOrThrow: async () =>
              childRow({ version: 5, deletedAt: new Date() }),
            findUnique: async () => ({ version: 5 }),
          },
          syncOperation: { create: async () => ({}) },
        }),
    };
    await createService(deletePrisma).softDelete(caregiver, 'child-1', 4);
    eq(seen[1]?.version, 4);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

/**
 * Sync child classroom persistence tests.
 * Run: npx ts-node src/modules/sync/__tests__/sync-apply-child-classroom.spec.ts
 */
import { SyncOperationStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import { SyncApplyService } from '../sync-apply.service';

function assert(name: string, fn: () => void | Promise<void>) {
  return (async () => {
    try {
      await fn();
      console.log(`PASS: ${name}`);
    } catch (e) {
      console.error(`FAIL: ${name}`);
      throw e;
    }
  })();
}

function eq(actual: unknown, expected: unknown, label?: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${label ?? 'eq'} expected ${e} got ${a}`);
  }
}

function noopTransferLifecycle() {
  return {
    createPending: async () => ({ status: 'conflict' as const, conflictReason: 'unused' }),
    accept: async () => ({ status: 'conflict' as const, conflictReason: 'unused' }),
    cancel: async () => ({ status: 'conflict' as const, conflictReason: 'unused' }),
  };
}

function noopBridge() {
  return {
    afterEntityCreated: async () => {},
    afterTransferCreated: async () => {},
    afterTransferAccepted: async () => {},
    afterTransferCancelled: async () => {},
    afterReferralStatusUpdated: async () => {},
    afterChildArchived: async () => {},
    afterComplianceStatusChanged: async () => {},
  };
}

async function main() {
  await assert('sync child create persists explicit classroomId', async () => {
    const centerId = randomUUID();
    const classroomId = randomUUID();
    const homeVillageId = randomUUID();
    const entityId = randomUUID();
    let createdClassroomId: string | null | undefined;

    const db = {
      child: {
        findUnique: async () => null,
        create: async ({ data }: { data: { id: string; classroomId?: string | null } }) => {
          createdClassroomId = data.classroomId ?? null;
          return data;
        },
        update: async () => {
          throw new Error('auto-assign should not run when classroomId is provided');
        },
      },
      ecdCenter: {
        findFirst: async () => ({ id: centerId }),
      },
      administrativeUnit: {
        findUnique: async () => ({ id: homeVillageId }),
      },
      classroom: {
        findFirst: async ({ where }: { where: { id: string; centerId: string } }) => {
          if (where.id === classroomId && where.centerId === centerId) {
            return { id: classroomId };
          }
          return null;
        },
      },
    };

    const service = new SyncApplyService(
      db as never,
      noopTransferLifecycle() as never,
      noopBridge() as never,
    );

    const result = await service.apply({
      deviceId: randomUUID(),
      entityType: 'child',
      entityId,
      localId: entityId,
      operation: 'create' as never,
      payload: {
        centerId,
        classroomId,
        homeVillageId,
        firstName: 'Jean',
        lastName: 'Test',
        dateOfBirth: '2024-01-01',
        gender: 'male',
        nationalId: '1202480100100199',
        guardianName: 'Guardian',
        guardianPhone: '0780000000',
        guardianRelation: 'parent',
        registeredAt: '2026-09-07',
      },
      clientVersion: 1,
    });

    eq(result.status, SyncOperationStatus.applied);
    eq(createdClassroomId, classroomId, 'classroomId must be written on create');
  });

  await assert('sync child create rejects classroomId from another center', async () => {
    const centerId = randomUUID();
    const classroomId = randomUUID();
    const homeVillageId = randomUUID();
    const entityId = randomUUID();

    const db = {
      child: {
        findUnique: async () => null,
        create: async () => {
          throw new Error('create should not run');
        },
      },
      ecdCenter: {
        findFirst: async () => ({ id: centerId }),
      },
      administrativeUnit: {
        findUnique: async () => ({ id: homeVillageId }),
      },
      classroom: {
        findFirst: async () => null,
      },
    };

    const service = new SyncApplyService(
      db as never,
      noopTransferLifecycle() as never,
      noopBridge() as never,
    );

    const result = await service.apply({
      deviceId: randomUUID(),
      entityType: 'child',
      entityId,
      localId: entityId,
      operation: 'create' as never,
      payload: {
        centerId,
        classroomId,
        homeVillageId,
        firstName: 'Jean',
        lastName: 'Test',
        dateOfBirth: '2024-01-01',
        gender: 'male',
        nationalId: '1202480100100199',
        guardianName: 'Guardian',
        guardianPhone: '0780000000',
        guardianRelation: 'parent',
        registeredAt: '2026-09-07',
      },
      clientVersion: 1,
    });

    eq(result.status, SyncOperationStatus.failed);
    eq(
      result.conflictReason?.includes('classroomId') ?? false,
      true,
      'should fail with classroomId validation error',
    );
  });

  await assert('sync child update persists classroomId', async () => {
    const centerId = randomUUID();
    const classroomId = randomUUID();
    const entityId = randomUUID();
    let updatedClassroomId: string | null | undefined;

    const db = {
      child: {
        findUnique: async () => ({ version: 1, centerId }),
        updateMany: async ({
          data,
        }: {
          data: { classroomId?: string | null };
        }) => {
          updatedClassroomId = data.classroomId;
          return { count: 1 };
        },
      },
      classroom: {
        findFirst: async ({ where }: { where: { id: string; centerId: string } }) => {
          if (where.id === classroomId && where.centerId === centerId) {
            return { id: classroomId };
          }
          return null;
        },
      },
    };

    const service = new SyncApplyService(
      db as never,
      noopTransferLifecycle() as never,
      noopBridge() as never,
    );

    const result = await service.apply({
      deviceId: randomUUID(),
      entityType: 'child',
      entityId,
      localId: entityId,
      operation: 'update' as never,
      payload: {
        classroomId,
        firstName: 'Jean',
      },
      clientVersion: 1,
    });

    eq(result.status, SyncOperationStatus.applied);
    eq(updatedClassroomId, classroomId, 'classroomId must be written on update');
  });

  console.log('\nAll sync child classroom tests passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

/**
 * Sync apply notification parity tests.
 * Run: npx ts-node src/modules/sync/__tests__/sync-apply-notifications.spec.ts
 */
import { NutritionStatus } from '../../../common/domain';
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

function createNutritionHarness(opts?: { existingEntity?: boolean }) {
  const bridgeCalls: string[] = [];
  let existing = opts?.existingEntity ?? false;

  const db = {
    child: {
      findUnique: async () => ({
        id: 'child-1',
        centerId: 'center-1',
      }),
    },
    childNutritionScreening: {
      findUnique: async () => (existing ? { version: 1 } : null),
      create: async ({ data }: { data: { id: string } }) => {
        existing = true;
        return data;
      },
    },
  };

  const bridge = {
    afterEntityCreated: async (entityType: string, entityId: string) => {
      bridgeCalls.push(`${entityType}:${entityId}`);
    },
    afterTransferCreated: async () => {},
    afterTransferAccepted: async () => {},
    afterTransferCancelled: async () => {},
    afterReferralStatusUpdated: async () => {},
    afterChildArchived: async () => {},
    afterComplianceStatusChanged: async () => {},
  };

  const service = new SyncApplyService(
    db as never,
    noopTransferLifecycle() as never,
    bridge as never,
  );

  return { service, bridgeCalls };
}

async function main() {
  await assert('sync severe nutrition create triggers notification bridge once', async () => {
    const h = createNutritionHarness();
    const entityId = randomUUID();

    const result = await h.service.apply({
      deviceId: randomUUID(),
      entityType: 'child_nutrition_screening',
      entityId,
      localId: entityId,
      operation: 'create' as never,
      payload: {
        childId: 'child-1',
        screeningDate: '2026-08-01',
        weightKg: 8,
        muacCm: 11,
        nutritionStatus: NutritionStatus.severe,
        recordedById: randomUUID(),
      },
      clientVersion: 1,
    });

    eq(result.status, SyncOperationStatus.applied);
    eq(h.bridgeCalls, ['child_nutrition_screening:' + entityId]);
  });

  await assert('sync nutrition replay conflict does not re-trigger notifications', async () => {
    const h = createNutritionHarness({ existingEntity: true });
    const entityId = randomUUID();

    const result = await h.service.apply({
      deviceId: randomUUID(),
      entityType: 'child_nutrition_screening',
      entityId,
      localId: entityId,
      operation: 'create' as never,
      payload: {
        childId: 'child-1',
        screeningDate: '2026-08-01',
        weightKg: 8,
        muacCm: 11,
        nutritionStatus: NutritionStatus.severe,
        recordedById: randomUUID(),
      },
      clientVersion: 1,
    });

    eq(result.status, SyncOperationStatus.conflict);
    eq(h.bridgeCalls.length, 0);
  });

  await assert(
    'sync normal nutrition create invokes bridge; event service filters notify',
    async () => {
      const bridgeCalls: string[] = [];
      const db = {
        child: {
          findUnique: async () => ({ id: 'child-1', centerId: 'center-1' }),
        },
        childNutritionScreening: {
          findUnique: async () => null,
          create: async ({ data }: { data: { id: string } }) => data,
        },
      };
      const bridge = {
        afterEntityCreated: async (entityType: string, entityId: string) => {
          bridgeCalls.push(`${entityType}:${entityId}`);
        },
        afterTransferCreated: async () => {},
        afterTransferAccepted: async () => {},
        afterTransferCancelled: async () => {},
        afterReferralStatusUpdated: async () => {},
        afterChildArchived: async () => {},
        afterComplianceStatusChanged: async () => {},
      };

      const service = new SyncApplyService(
        db as never,
        noopTransferLifecycle() as never,
        bridge as never,
      );
      const entityId = randomUUID();

      await service.apply({
        deviceId: randomUUID(),
        entityType: 'child_nutrition_screening',
        entityId,
        localId: entityId,
        operation: 'create' as never,
        payload: {
          childId: 'child-1',
          screeningDate: '2026-08-01',
          weightKg: 12,
          muacCm: 14,
          nutritionStatus: NutritionStatus.normal,
          recordedById: randomUUID(),
        },
        clientVersion: 1,
      });

      eq(
        bridgeCalls.length,
        1,
        'bridge still invoked; filtering happens in NotificationEventsService',
      );
    },
  );

  await assert('sync ecd_center create triggers notification bridge once', async () => {
    const bridgeCalls: string[] = [];
    const db = {
      ecdCenter: {
        findUnique: async () => null,
        create: async ({ data }: { data: { id: string } }) => data,
      },
    };
    const bridge = {
      afterEntityCreated: async (entityType: string, entityId: string) => {
        bridgeCalls.push(`${entityType}:${entityId}`);
      },
      afterTransferCreated: async () => {},
      afterTransferAccepted: async () => {},
      afterTransferCancelled: async () => {},
      afterReferralStatusUpdated: async () => {},
      afterChildArchived: async () => {},
      afterComplianceStatusChanged: async () => {},
    };

    const service = new SyncApplyService(
      db as never,
      noopTransferLifecycle() as never,
      bridge as never,
    );
    const entityId = randomUUID();

    const result = await service.apply({
      deviceId: randomUUID(),
      entityType: 'ecd_center',
      entityId,
      localId: entityId,
      operation: 'create' as never,
      payload: {
        districtId: randomUUID(),
        villageId: randomUUID(),
        code: 'ECD-NEW-1',
        name: 'New Center',
      },
      clientVersion: 1,
    });

    eq(result.status, SyncOperationStatus.applied);
    eq(bridgeCalls, ['ecd_center:' + entityId]);
  });

  console.log('\nAll sync apply notification tests passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

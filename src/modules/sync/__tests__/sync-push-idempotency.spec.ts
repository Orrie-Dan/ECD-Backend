import { AuditAction, DeviceStatus, SyncOperationStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import { SyncService } from '../sync.service';

type OpRow = {
  id: string;
  deviceId: string;
  sessionId: string | null;
  clientOperationId: string | null;
  entityType: string;
  entityId: string;
  localId: string | null;
  operation: AuditAction;
  payload: unknown;
  status: SyncOperationStatus;
  conflictReason: string | null;
  clientTimestamp: Date;
  createdAt: Date;
  processedAt: Date | null;
};

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

class FakeQueue {
  jobs: Array<{ name: string; data: { sessionId: string } }> = [];
  async add(name: string, data: { sessionId: string }) {
    this.jobs.push({ name, data });
    return { id: randomUUID() };
  }
}

function createHarness() {
  const ops = new Map<string, OpRow>();
  const uniqueIndex = new Map<string, string>(); // deviceId|clientOpId -> opId
  const sessions = new Map<string, { id: string; deviceId: string }>();
  const queue = new FakeQueue();

  const deviceId = randomUUID();
  const userId = randomUUID();

  const prisma = {
    device: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        if (where.id !== deviceId) return null;
        return {
          id: deviceId,
          userId,
          status: DeviceStatus.active,
        };
      },
    },
    syncOperation: {
      findMany: async ({
        where,
      }: {
        where: { deviceId: string; clientOperationId: { in: string[] } };
      }) => {
        return [...ops.values()].filter(
          (o) =>
            o.deviceId === where.deviceId &&
            o.clientOperationId != null &&
            where.clientOperationId.in.includes(o.clientOperationId),
        );
      },
      findFirst: async ({
        where,
      }: {
        where: { deviceId: string; clientOperationId: string };
      }) => {
        return (
          [...ops.values()].find(
            (o) =>
              o.deviceId === where.deviceId &&
              o.clientOperationId === where.clientOperationId,
          ) ?? null
        );
      },
      create: async ({ data }: { data: OpRow }) => {
        if (data.clientOperationId) {
          const key = `${data.deviceId}|${data.clientOperationId}`;
          if (uniqueIndex.has(key)) {
            const err = new Error('Unique constraint failed') as Error & {
              code: string;
            };
            // Mimic Prisma P2002 without importing full Prisma error in harness.
            Object.assign(err, { code: 'P2002', name: 'PrismaClientKnownRequestError' });
            // SyncService checks instanceof Prisma.PrismaClientKnownRequestError —
            // for unit harness we simulate race via direct uniqueIndex instead.
            throw Object.assign(new Error('P2002'), {
              code: 'P2002',
              constructor: { name: 'PrismaClientKnownRequestError' },
            });
          }
          uniqueIndex.set(key, data.id);
        }
        ops.set(data.id, { ...data });
        return data;
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: { in: string[] } };
        data: { sessionId: string };
      }) => {
        let count = 0;
        for (const id of where.id.in) {
          const row = ops.get(id);
          if (row) {
            row.sessionId = data.sessionId;
            count += 1;
          }
        }
        return { count };
      },
    },
    syncSession: {
      create: async ({ data }: { data: { id: string; deviceId: string } }) => {
        sessions.set(data.id, data);
        return data;
      },
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
  };

  // Patch create to use a Prisma-like error class the service recognizes.
  const { Prisma } = require('@prisma/client');
  prisma.syncOperation.create = async ({ data }: { data: OpRow }) => {
    if (data.clientOperationId) {
      const key = `${data.deviceId}|${data.clientOperationId}`;
      if (uniqueIndex.has(key)) {
        throw new Prisma.PrismaClientKnownRequestError('Unique constraint', {
          code: 'P2002',
          clientVersion: 'test',
        });
      }
      uniqueIndex.set(key, data.id);
    }
    ops.set(data.id, { ...data });
    return data;
  };

  const syncAccess = {
    resolveScope: async () => ({ centerIds: 'all' as const, districtId: null }),
    authorizeSyncWrite: async () => ({ allowed: true as const }),
    logRejectedSyncOperation: () => undefined,
  };

  const service = new SyncService(
    prisma as never,
    syncAccess as never,
    queue as never,
  );

  const user = {
    id: userId,
    username: 'caregiver1',
    email: null,
    fullName: 'Caregiver',
    role: 'caregiver' as const,
    centerId: randomUUID(),
    districtId: null,
    status: 'active' as const,
  };

  return { service, user, deviceId, ops, uniqueIndex, sessions, queue };
}

async function main() {
  await assert('Scenario 1: retry returns existing result', async () => {
    const { service, user, deviceId, ops, queue } = createHarness();
    const clientOperationId = randomUUID();
    const entityId = randomUUID();

    const first = await service.push(user as never, {
      deviceId,
      operations: [
        {
          clientOperationId,
          entityType: 'child',
          operation: AuditAction.create,
          entityId,
          version: 1,
          payload: { firstName: 'Ada' },
        },
      ],
    });

    eq(first.created, 1);
    eq(first.deduplicated, 0);
    eq(first.operations[0].replayed, false);
    eq(first.operations[0].status, SyncOperationStatus.pending);
    eq(ops.size, 1);
    eq(queue.jobs.length, 1);
    const firstOpId = first.operations[0].id;
    const firstSessionId = first.sessionId;

    const second = await service.push(user as never, {
      deviceId,
      operations: [
        {
          clientOperationId,
          entityType: 'child',
          operation: AuditAction.create,
          entityId,
          version: 1,
          payload: { firstName: 'Ada' },
        },
      ],
    });

    eq(second.created, 0);
    eq(second.deduplicated, 1);
    eq(second.sessionId, null);
    eq(second.operations[0].replayed, true);
    eq(second.operations[0].id, firstOpId);
    eq(second.operations[0].sessionId, firstSessionId);
    eq(ops.size, 1, 'no duplicate operation row');
    eq(queue.jobs.length, 1, 'no second queue job');
  });

  await assert('Scenario 2: network retry does not duplicate', async () => {
    const { service, user, deviceId, ops } = createHarness();
    const clientOperationId = 'op-stable-retry-1';

    await service.push(user as never, {
      deviceId,
      operations: [
        {
          clientOperationId,
          entityType: 'attendance_record',
          operation: AuditAction.create,
          version: 0,
          payload: { childId: randomUUID() },
        },
      ],
    });

    await service.push(user as never, {
      deviceId,
      operations: [
        {
          clientOperationId,
          entityType: 'attendance_record',
          operation: AuditAction.create,
          version: 0,
          payload: { childId: randomUUID() },
        },
      ],
    });

    await service.push(user as never, {
      deviceId,
      operations: [
        {
          clientOperationId,
          entityType: 'attendance_record',
          operation: AuditAction.create,
          version: 0,
          payload: { childId: randomUUID() },
        },
      ],
    });

    eq(ops.size, 1);
  });

  await assert('Scenario 3: concurrent identical inserts keep one row', async () => {
    const { service, user, deviceId, ops, uniqueIndex } = createHarness();
    const clientOperationId = randomUUID();

    // Seed as if a concurrent request already inserted.
    const existingId = randomUUID();
    ops.set(existingId, {
      id: existingId,
      deviceId,
      sessionId: randomUUID(),
      clientOperationId,
      entityType: 'child',
      entityId: randomUUID(),
      localId: null,
      operation: AuditAction.create,
      payload: {},
      status: SyncOperationStatus.pending,
      conflictReason: null,
      clientTimestamp: new Date(),
      createdAt: new Date(),
      processedAt: null,
    });
    uniqueIndex.set(`${deviceId}|${clientOperationId}`, existingId);

    // Clear findMany prefetch so push thinks it's new, then create hits P2002.
    const originalFindMany = (service as unknown as { prisma: { syncOperation: { findMany: Function } } })
      .prisma.syncOperation.findMany;
    (service as unknown as { prisma: { syncOperation: { findMany: Function } } }).prisma.syncOperation.findMany =
      async () => [];

    const result = await service.push(user as never, {
      deviceId,
      operations: [
        {
          clientOperationId,
          entityType: 'child',
          operation: AuditAction.create,
          version: 1,
          payload: {},
        },
      ],
    });

    (service as unknown as { prisma: { syncOperation: { findMany: Function } } }).prisma.syncOperation.findMany =
      originalFindMany;

    eq(result.operations[0].replayed, true);
    eq(result.operations[0].id, existingId);
    eq(ops.size, 1);
  });

  await assert('Rejects duplicate clientOperationId inside one batch', async () => {
    const { service, user, deviceId } = createHarness();
    const clientOperationId = randomUUID();
    let caught = false;
    try {
      await service.push(user as never, {
        deviceId,
        operations: [
          {
            clientOperationId,
            entityType: 'child',
            operation: AuditAction.create,
            version: 1,
          },
          {
            clientOperationId,
            entityType: 'child',
            operation: AuditAction.update,
            version: 1,
          },
        ],
      });
    } catch (e) {
      caught = true;
      eq(
        (e as Error).message.includes('Duplicate clientOperationId'),
        true,
      );
    }
    eq(caught, true);
  });

  console.log('\nAll sync push idempotency tests passed.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

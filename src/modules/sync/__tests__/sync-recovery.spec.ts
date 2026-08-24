/**
 * Pending sync operation recovery tests.
 * Run: npx ts-node src/modules/sync/__tests__/sync-recovery.spec.ts
 */
import { SyncOperationStatus, SyncSessionStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import { SyncService } from '../sync.service';
import {
  SYNC_JOB_PROCESS_SESSION,
  SYNC_MAX_RECOVERY_RETRIES,
  SYNC_PARKED_RETRY_MS,
  SYNC_STALE_THRESHOLD_MS,
} from '../sync.constants';

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

type SessionRow = {
  id: string;
  status: SyncSessionStatus;
  startedAt: Date;
  retryCount: number;
  lastRetryAt: Date | null;
  successfulOperations: number;
  failedOperations: number;
  completedAt: Date | null;
  deviceId: string;
};

type OpRow = {
  id: string;
  sessionId: string;
  status: SyncOperationStatus;
  conflictReason: string | null;
  processedAt: Date | null;
};

function createRecoveryHarness(opts?: { inFlightSessionIds?: string[] }) {
  const sessions = new Map<string, SessionRow>();
  const ops = new Map<string, OpRow>();
  const enqueued: Array<{ name: string; data: { sessionId: string }; opts?: unknown }> = [];

  const prisma: {
    syncSession: {
      findMany: (args: unknown) => Promise<unknown>;
      update: (args: unknown) => Promise<unknown>;
      findUnique: (args: unknown) => Promise<unknown>;
    };
    syncOperation: {
      updateMany: (args: unknown) => Promise<unknown>;
      findMany: (args: unknown) => Promise<unknown>;
    };
    $transaction: (fn: (tx: unknown) => Promise<unknown>) => Promise<unknown>;
  } = {
    syncSession: {
      findMany: async ({
        where,
        take,
      }: {
        where: {
          status: SyncSessionStatus;
          startedAt: { lt: Date };
          operations: { some: { status: SyncOperationStatus } };
        };
        take: number;
        orderBy: unknown;
        select: unknown;
      }) => {
        return [...sessions.values()]
          .filter((s) => {
            if (s.status !== where.status) return false;
            if (!(s.startedAt < where.startedAt.lt)) return false;
            const hasPending = [...ops.values()].some(
              (o) => o.sessionId === s.id && o.status === where.operations.some.status,
            );
            return hasPending;
          })
          .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime())
          .slice(0, take)
          .map((s) => ({
            id: s.id,
            retryCount: s.retryCount,
            startedAt: s.startedAt,
            lastRetryAt: s.lastRetryAt,
            deviceId: s.deviceId,
          }));
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<SessionRow> }) => {
        const s = sessions.get(where.id)!;
        Object.assign(s, data);
        return s;
      },
      findUnique: async () => null,
    },
    syncOperation: {
      updateMany: async ({
        where,
        data,
      }: {
        where: { sessionId: string; status: SyncOperationStatus };
        data: Partial<OpRow>;
      }) => {
        let count = 0;
        for (const op of ops.values()) {
          if (op.sessionId === where.sessionId && op.status === where.status) {
            Object.assign(op, data);
            count += 1;
          }
        }
        return { count };
      },
      findMany: async ({ where }: { where: { sessionId: string }; select?: unknown }) => {
        return [...ops.values()]
          .filter((o) => o.sessionId === where.sessionId)
          .map((o) => ({ status: o.status }));
      },
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
  };

  const queue = {
    add: async (name: string, data: { sessionId: string }, opts?: unknown) => {
      enqueued.push({ name, data, opts });
      return { id: randomUUID() };
    },
    getJobs: async () =>
      (opts?.inFlightSessionIds ?? []).map((sessionId) => ({
        name: SYNC_JOB_PROCESS_SESSION,
        data: { sessionId },
      })),
  };

  const syncAccess = {
    resolveScope: async () => ({ centerIds: 'all', districtId: null }),
  };

  const service = new SyncService(prisma as never, syncAccess as never, queue as never);

  return { service, sessions, ops, enqueued, prisma };
}

function seedStaleSession(
  h: ReturnType<typeof createRecoveryHarness>,
  overrides: Partial<SessionRow> & { pending?: boolean } = {},
) {
  const id = overrides.id ?? randomUUID();
  const startedAt = overrides.startedAt ?? new Date(Date.now() - SYNC_STALE_THRESHOLD_MS - 60_000);
  h.sessions.set(id, {
    id,
    status: overrides.status ?? SyncSessionStatus.started,
    startedAt,
    retryCount: overrides.retryCount ?? 0,
    lastRetryAt: overrides.lastRetryAt ?? null,
    successfulOperations: overrides.successfulOperations ?? 0,
    failedOperations: overrides.failedOperations ?? 0,
    completedAt: overrides.completedAt ?? null,
    deviceId: overrides.deviceId ?? randomUUID(),
  });
  if (overrides.pending !== false) {
    const opId = randomUUID();
    h.ops.set(opId, {
      id: opId,
      sessionId: id,
      status: SyncOperationStatus.pending,
      conflictReason: null,
      processedAt: null,
    });
  }
  return id;
}

async function main() {
  await assert('requeues stale pending session and increments retryCount', async () => {
    const h = createRecoveryHarness();
    const sessionId = seedStaleSession(h, { retryCount: 0 });
    const now = new Date();

    const result = await h.service.recoverStalePendingSessions(now);

    eq(result.scanned, 1);
    eq(result.requeued, 1);
    eq(result.deadLettered, 0);
    eq(h.sessions.get(sessionId)!.retryCount, 1);
    eq(h.sessions.get(sessionId)!.lastRetryAt?.toISOString(), now.toISOString());
    eq(h.enqueued.length, 1);
    eq(h.enqueued[0].name, SYNC_JOB_PROCESS_SESSION);
    eq(h.enqueued[0].data.sessionId, sessionId);

    const stillPending = [...h.ops.values()].every((o) => o.status === SyncOperationStatus.pending);
    eq(stillPending, true, 'ops remain pending until worker applies');
  });

  await assert('skips sessions that already have in-flight jobs', async () => {
    const sessionId = randomUUID();
    const h = createRecoveryHarness({ inFlightSessionIds: [sessionId] });
    seedStaleSession(h, { id: sessionId, retryCount: 1 });

    const result = await h.service.recoverStalePendingSessions();
    eq(result.requeued, 0);
    eq(h.enqueued.length, 0);
    eq(h.sessions.get(sessionId)!.retryCount, 1);
  });

  await assert('parks after max recovery retries without failing ops', async () => {
    const h = createRecoveryHarness();
    const sessionId = seedStaleSession(h, {
      retryCount: SYNC_MAX_RECOVERY_RETRIES,
    });

    const result = await h.service.recoverStalePendingSessions();

    eq(result.deadLettered, 0);
    eq(result.requeued, 0);
    eq(result.parkedRequeued, 0);
    eq(h.enqueued.length, 0);
    eq(h.sessions.get(sessionId)!.status, SyncSessionStatus.started);

    const op = [...h.ops.values()].find((o) => o.sessionId === sessionId)!;
    eq(op.status, SyncOperationStatus.pending);
  });

  await assert('requeues parked sessions after parked backoff', async () => {
    const h = createRecoveryHarness();
    const sessionId = seedStaleSession(h, {
      retryCount: SYNC_MAX_RECOVERY_RETRIES,
      lastRetryAt: new Date(Date.now() - SYNC_PARKED_RETRY_MS - 1000),
    });

    const result = await h.service.recoverStalePendingSessions();

    eq(result.parkedRequeued, 1);
    eq(result.deadLettered, 0);
    eq(h.enqueued.length, 1);
    eq(h.sessions.get(sessionId)!.status, SyncSessionStatus.started);
    const op = [...h.ops.values()].find((o) => o.sessionId === sessionId)!;
    eq(op.status, SyncOperationStatus.pending);
  });

  await assert('ignores fresh sessions below stale threshold', async () => {
    const h = createRecoveryHarness();
    seedStaleSession(h, {
      startedAt: new Date(), // fresh
      retryCount: 0,
    });

    const result = await h.service.recoverStalePendingSessions();
    eq(result.scanned, 0);
    eq(h.enqueued.length, 0);
  });

  await assert('ignores terminal sessions (completed/failed)', async () => {
    const h = createRecoveryHarness();
    seedStaleSession(h, {
      status: SyncSessionStatus.completed,
      retryCount: 0,
    });

    const result = await h.service.recoverStalePendingSessions();
    eq(result.scanned, 0);
  });

  await assert('does not touch applied/conflict/failed operations', async () => {
    const h = createRecoveryHarness();
    const sessionId = seedStaleSession(h, {
      retryCount: SYNC_MAX_RECOVERY_RETRIES,
    });
    const appliedId = randomUUID();
    h.ops.set(appliedId, {
      id: appliedId,
      sessionId,
      status: SyncOperationStatus.applied,
      conflictReason: null,
      processedAt: new Date(),
    });

    await h.service.recoverStalePendingSessions();

    eq(h.ops.get(appliedId)!.status, SyncOperationStatus.applied);
    const stillPending = [...h.ops.values()].filter(
      (o) =>
        o.sessionId === sessionId && o.id !== appliedId && o.status === SyncOperationStatus.pending,
    );
    eq(stillPending.length, 1);
  });

  console.log('\nAll sync recovery tests passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

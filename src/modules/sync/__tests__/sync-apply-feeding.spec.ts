import { SyncOperationStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import { createMockLookupResolver } from '../../../common/lookups/lookup-resolver.mock';
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

type FeedingDayRow = {
  id: string;
  centerId: string;
  recordedDate: Date;
  version: number;
  milkServed: boolean;
};

function createApplyHarness(opts?: { existing?: FeedingDayRow | null; recorderExists?: boolean }) {
  const created: unknown[] = [];
  const updated: unknown[] = [];
  let existing = opts?.existing ?? null;
  const recorderExists = opts?.recorderExists !== false;

  const db = {
    userAccount: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        recorderExists && where.id && where.id !== 'undefined' ? { id: where.id } : null,
    },
    centerFeedingDay: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        existing && existing.id === where.id ? { version: existing.version } : null,
      findFirst: async ({ where }: { where: { centerId: string; recordedDate: Date } }) => {
        if (!existing) return null;
        if (existing.centerId !== where.centerId) return null;
        if (existing.recordedDate.getTime() !== where.recordedDate.getTime()) return null;
        return existing;
      },
      create: async ({ data }: { data: FeedingDayRow }) => {
        created.push(data);
        existing = {
          id: data.id,
          centerId: data.centerId,
          recordedDate: data.recordedDate,
          version: 1,
          milkServed: Boolean((data as { milkServed?: boolean }).milkServed),
        };
        return existing;
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: { milkServed?: boolean; version: { increment: number } };
      }) => {
        if (!existing || existing.id !== where.id) {
          throw new Error('missing feeding day');
        }
        existing = {
          ...existing,
          milkServed: data.milkServed ?? existing.milkServed,
          version: existing.version + (data.version?.increment ?? 1),
        };
        updated.push(data);
        return existing;
      },
    },
  };

  const service = new SyncApplyService(db as never, {} as never, createMockLookupResolver());
  return { service, created, updated, getExisting: () => existing };
}

async function main() {
  const recorderId = randomUUID();

  await assert('feeding day create applies when no natural-key sibling', async () => {
    const h = createApplyHarness();
    const entityId = randomUUID();
    const result = await h.service.apply({
      deviceId: randomUUID(),
      entityType: 'center_feeding_day',
      entityId,
      localId: entityId,
      operation: 'create' as never,
      payload: {
        centerId: 'center-1',
        recordedDate: '2026-08-12',
        milkServed: true,
        recordedById: recorderId,
      },
      clientVersion: 0,
    });
    eq(result.status, SyncOperationStatus.applied);
    eq(h.created.length, 1);
    eq(h.updated.length, 0);
  });

  await assert(
    'feeding day create with different UUID upserts existing (centerId, date)',
    async () => {
      const existingId = randomUUID();
      const h = createApplyHarness({
        existing: {
          id: existingId,
          centerId: 'center-1',
          recordedDate: new Date('2026-08-12'),
          version: 1,
          milkServed: false,
        },
      });
      const result = await h.service.apply({
        deviceId: randomUUID(),
        entityType: 'center_feeding_day',
        entityId: randomUUID(),
        localId: null,
        operation: 'create' as never,
        payload: {
          centerId: 'center-1',
          recordedDate: '2026-08-12',
          milkServed: true,
          recordedById: recorderId,
        },
        clientVersion: 0,
      });
      eq(result.status, SyncOperationStatus.applied);
      eq(result.entityId, existingId);
      eq(h.created.length, 0);
      eq(h.updated.length, 1);
    },
  );

  await assert(
    'feeding day create accepts date alias when recordedDate missing (5.9A harness)',
    async () => {
      const h = createApplyHarness();
      const entityId = randomUUID();
      const result = await h.service.apply({
        deviceId: randomUUID(),
        entityType: 'center_feeding_day',
        entityId,
        localId: entityId,
        operation: 'create' as never,
        payload: {
          centerId: 'center-1',
          date: '2026-08-05',
          milkServed: true,
          recordedById: recorderId,
        },
        clientVersion: 0,
      });
      eq(result.status, SyncOperationStatus.applied);
      eq(h.created.length, 1);
      const created = h.created[0] as { recordedDate: Date };
      eq(created.recordedDate.toISOString().slice(0, 10), '2026-08-05');
    },
  );

  await assert('feeding day create without date/recordedDate is terminal failed', async () => {
    const h = createApplyHarness();
    const result = await h.service.apply({
      deviceId: randomUUID(),
      entityType: 'center_feeding_day',
      entityId: randomUUID(),
      localId: null,
      operation: 'create' as never,
      payload: {
        centerId: 'center-1',
        milkServed: true,
        recordedById: recorderId,
      },
      clientVersion: 0,
    });
    eq(result.status, SyncOperationStatus.failed);
    eq(result.retryable ?? false, false);
    if (!String(result.conflictReason || '').includes('recordedDate')) {
      throw new Error(`expected recordedDate message, got ${result.conflictReason}`);
    }
  });

  await assert(
    'feeding day create without recordedById is terminal failed (not P2003 retry)',
    async () => {
      const h = createApplyHarness();
      const result = await h.service.apply({
        deviceId: randomUUID(),
        entityType: 'center_feeding_day',
        entityId: randomUUID(),
        localId: null,
        operation: 'create' as never,
        payload: {
          centerId: 'center-1',
          recordedDate: '2026-08-02',
          milkServed: true,
        },
        clientVersion: 0,
      });
      eq(result.status, SyncOperationStatus.failed);
      eq(result.retryable ?? false, false);
      if (!String(result.conflictReason || '').includes('recordedById')) {
        throw new Error(`expected recordedById message, got ${result.conflictReason}`);
      }
    },
  );

  await assert('feeding day create with recordedBy alias applies', async () => {
    const h = createApplyHarness();
    const result = await h.service.apply({
      deviceId: randomUUID(),
      entityType: 'center_feeding_day',
      entityId: randomUUID(),
      localId: null,
      operation: 'create' as never,
      payload: {
        centerId: 'center-1',
        recordedDate: '2026-07-30',
        milkServed: true,
        recordedBy: recorderId,
      },
      clientVersion: 0,
    });
    eq(result.status, SyncOperationStatus.applied);
    eq(h.created.length, 1);
  });

  console.log('\nAll feeding apply assertions passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

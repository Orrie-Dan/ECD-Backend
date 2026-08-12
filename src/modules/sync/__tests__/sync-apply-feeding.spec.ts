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

type FeedingDayRow = {
  id: string;
  centerId: string;
  recordedDate: Date;
  version: number;
  milkServed: boolean;
};

function createApplyHarness(opts?: { existing?: FeedingDayRow | null }) {
  const created: unknown[] = [];
  const updated: unknown[] = [];
  let existing = opts?.existing ?? null;

  const db = {
    centerFeedingDay: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        existing && existing.id === where.id ? { version: existing.version } : null,
      findFirst: async ({
        where,
      }: {
        where: { centerId: string; recordedDate: Date };
      }) => {
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

  const service = new SyncApplyService(db as never, {} as never);
  return { service, created, updated, getExisting: () => existing };
}

async function main() {
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
        recordedById: randomUUID(),
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
          recordedById: randomUUID(),
        },
        clientVersion: 0,
      });
      eq(result.status, SyncOperationStatus.applied);
      eq(result.entityId, existingId);
      eq(h.created.length, 0);
      eq(h.updated.length, 1);
    },
  );

  console.log('\nAll feeding apply assertions passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

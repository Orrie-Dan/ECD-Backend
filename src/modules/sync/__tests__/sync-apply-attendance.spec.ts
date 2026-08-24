import { Prisma, SyncOperationStatus } from '@prisma/client';
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

type AttendanceRow = {
  id: string;
  childId: string;
  attendanceDate: Date;
  version: number;
  lastModifiedAt: Date;
  status: string;
};

function createApplyHarness(opts?: { childExists?: boolean; existing?: AttendanceRow | null }) {
  const created: unknown[] = [];
  const updated: unknown[] = [];
  let existing = opts?.existing ?? null;

  const db = {
    child: {
      findUnique: async () =>
        opts?.childExists === false ? null : { id: 'child-1', centerId: 'center-1' },
    },
    attendanceRecord: {
      findFirst: async () => existing,
      findUnique: async ({ where }: { where: { id: string } }) =>
        existing && existing.id === where.id ? { version: existing.version } : null,
      create: async ({ data }: { data: AttendanceRow }) => {
        created.push(data);
        existing = {
          id: data.id,
          childId: data.childId,
          attendanceDate: data.attendanceDate,
          version: 1,
          lastModifiedAt: new Date(),
          status: 'present',
        };
        return existing;
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: string; version: number };
        data: { version: { increment: number } };
      }) => {
        if (!existing || existing.id !== where.id || existing.version !== where.version) {
          return { count: 0 };
        }
        existing = {
          ...existing,
          version: existing.version + (data.version?.increment ?? 1),
          lastModifiedAt: new Date(),
        };
        updated.push(data);
        return { count: 1 };
      },
    },
  };

  const service = new SyncApplyService(db as never, {} as never);
  return { service, created, updated, getExisting: () => existing };
}

async function main() {
  await assert('attendance create applies when child exists and no sibling', async () => {
    const h = createApplyHarness({ childExists: true });
    const entityId = randomUUID();
    const result = await h.service.apply({
      deviceId: randomUUID(),
      entityType: 'attendance_record',
      entityId,
      localId: entityId,
      operation: 'create' as never,
      payload: {
        childId: 'child-1',
        centerId: 'center-1',
        attendanceDate: '2026-08-12',
        present: true,
        recordedById: randomUUID(),
      },
      clientVersion: 0,
    });
    eq(result.status, SyncOperationStatus.applied);
    eq(h.created.length, 1);
  });

  await assert('attendance create is retryable when parent child is missing', async () => {
    const h = createApplyHarness({ childExists: false });
    const result = await h.service.apply({
      deviceId: randomUUID(),
      entityType: 'attendance_record',
      entityId: randomUUID(),
      localId: null,
      operation: 'create' as never,
      payload: {
        childId: 'missing-child',
        attendanceDate: '2026-08-12',
        present: true,
        recordedById: randomUUID(),
      },
      clientVersion: 0,
    });
    eq(result.status, SyncOperationStatus.pending);
    eq(result.retryable, true);
    eq(h.created.length, 0);
  });

  await assert('same child+date different UUID is idempotent when server is newer', async () => {
    const existingId = randomUUID();
    const h = createApplyHarness({
      childExists: true,
      existing: {
        id: existingId,
        childId: 'child-1',
        attendanceDate: new Date('2026-08-12'),
        version: 2,
        lastModifiedAt: new Date('2026-08-12T12:00:00.000Z'),
        status: 'present',
      },
    });
    const result = await h.service.apply({
      deviceId: randomUUID(),
      entityType: 'attendance_record',
      entityId: randomUUID(),
      localId: null,
      operation: 'create' as never,
      payload: {
        childId: 'child-1',
        centerId: 'center-1',
        attendanceDate: '2026-08-12',
        present: false,
        absentReason: 'sick',
        recordedById: randomUUID(),
      },
      clientVersion: 0,
      clientTimestamp: new Date('2026-08-12T10:00:00.000Z'),
    });
    eq(result.status, SyncOperationStatus.applied);
    eq(result.entityId, existingId);
    eq(h.created.length, 0);
    eq(h.updated.length, 0);
  });

  await assert('same child+date CAS-updates when client is newer', async () => {
    const existingId = randomUUID();
    const h = createApplyHarness({
      childExists: true,
      existing: {
        id: existingId,
        childId: 'child-1',
        attendanceDate: new Date('2026-08-12'),
        version: 1,
        lastModifiedAt: new Date('2026-08-12T08:00:00.000Z'),
        status: 'present',
      },
    });
    const result = await h.service.apply({
      deviceId: randomUUID(),
      entityType: 'attendance_record',
      entityId: randomUUID(),
      localId: null,
      operation: 'create' as never,
      payload: {
        childId: 'child-1',
        centerId: 'center-1',
        attendanceDate: '2026-08-12',
        present: false,
        absentReason: 'sick',
        recordedById: randomUUID(),
      },
      clientVersion: 0,
      clientTimestamp: new Date('2026-08-12T11:00:00.000Z'),
    });
    eq(result.status, SyncOperationStatus.applied);
    eq(result.entityId, existingId);
    eq(h.created.length, 0);
    eq(h.updated.length, 1);
  });

  await assert('P2003 is classified retryable', async () => {
    const err = new Prisma.PrismaClientKnownRequestError('FK', {
      code: 'P2003',
      clientVersion: '6.0.0',
    });
    const { isRetryableApplyError } = await import('../sync-apply.service');
    eq(isRetryableApplyError(err), true);
    const permanent = new Prisma.PrismaClientKnownRequestError('check', {
      code: 'P2002',
      clientVersion: '6.0.0',
    });
    eq(isRetryableApplyError(permanent), false);
  });

  console.log('\nAll attendance apply tests passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

/**
 * Offline sync ecd_center create/update with NCDA codes.
 * Run: npx ts-node src/modules/sync/__tests__/sync-apply-ecd-center.spec.ts
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

const ISSUED = '0101010101/B/2021/03';

function fakeDb(opts: {
  village?: { id: string; districtId: string | null; minalocCode: string | null } | null;
  lastSeq?: number;
  current?: { ncdaTypeCode: string | null; facilityType: string | null; version?: number };
}) {
  const calls = {
    raw: [] as unknown[][],
    created: null as Record<string, unknown> | null,
    updated: null as Record<string, unknown> | null,
  };
  const db = {
    $queryRaw: async (_strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.raw.push(values);
      return [{ code: ISSUED }];
    },
    administrativeUnit: {
      findFirst: async () =>
        opts.village === undefined
          ? { id: 'village-1', districtId: 'district-1', minalocCode: '0101010101' }
          : opts.village,
    },
    ecdCodeSequence: {
      findUnique: async () => (opts.lastSeq == null ? null : { lastSeq: opts.lastSeq }),
    },
    ecdCenter: {
      findUnique: async () =>
        opts.current
          ? { id: 'center-1', version: opts.current.version ?? 1, ...opts.current }
          : null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        calls.created = data;
        return data;
      },
      updateMany: async ({ data }: { data: Record<string, unknown> }) => {
        calls.updated = data;
        return { count: 1 };
      },
    },
  };
  return { db, calls };
}

function service(db: unknown) {
  return new SyncApplyService(db as never, noopTransferLifecycle() as never, noopBridge() as never);
}

const basePayload = {
  districtId: 'district-1',
  villageId: 'village-1',
  name: 'Offline Center',
  ncdaTypeCode: 'B',
  startYear: 2021,
};

function createOp(payload: Record<string, unknown>) {
  const id = randomUUID();
  return {
    deviceId: randomUUID(),
    entityType: 'ecd_center' as const,
    entityId: id,
    localId: id,
    operation: 'create' as never,
    payload,
    clientVersion: 1,
  };
}

async function main() {
  await assert('create: server issues code and ignores client code', async () => {
    const { db, calls } = fakeDb({});
    const op = createOp({ ...basePayload, code: 'CLIENT-CODE' });
    const result = await service(db).apply(op);
    eq(result.status, SyncOperationStatus.applied);
    eq(calls.raw[0], [op.entityId, 'village-1', 'B', 2021, null], 'issue args');
    eq(calls.created!.code, ISSUED);
    eq(calls.created!.facilityType, 'home_based');
    eq(calls.created!.ncdaTypeCode, 'B');
    eq(calls.created!.startYear, 2021);
  });

  const rejectCases: Array<
    [string, Parameters<typeof fakeDb>[0], Record<string, unknown>, string]
  > = [
    ['missing type letter', {}, { ...basePayload, ncdaTypeCode: undefined }, 'ncdaTypeCode'],
    ['bad type letter', {}, { ...basePayload, ncdaTypeCode: 'Z' }, 'ncdaTypeCode'],
    [
      'future start year',
      {},
      { ...basePayload, startYear: new Date().getUTCFullYear() + 1 },
      'startYear',
    ],
    [
      'village in another district',
      { village: { id: 'village-1', districtId: 'district-9', minalocCode: '0909090909' } },
      basePayload,
      'not in districtId',
    ],
    [
      'village without MINALOC code',
      { village: { id: 'village-1', districtId: 'district-1', minalocCode: null } },
      basePayload,
      'MINALOC',
    ],
    ['village counter exhausted', { lastSeq: 99 }, basePayload, '99'],
    // Must fail before issue_ecd_code: a failure after it would leave a registry
    // row with no center and the apply transaction could not commit.
    ['non-numeric capacity', {}, { ...basePayload, capacity: 'abc' }, 'capacity'],
    ['negative capacity', {}, { ...basePayload, capacity: -1 }, 'capacity'],
    ['non-numeric latitude', {}, { ...basePayload, latitude: 'north' }, 'latitude'],
    ['unknown status', {}, { ...basePayload, status: 'closed' }, 'status'],
    ['non-string phone', {}, { ...basePayload, phone: 788123456 }, 'phone'],
  ];
  for (const [label, dbOpts, payload, text] of rejectCases) {
    await assert(`create: ${label} → failed before any write`, async () => {
      const { db, calls } = fakeDb(dbOpts);
      const result = await service(db).apply(createOp(payload));
      eq(result.status, SyncOperationStatus.failed);
      if (!String(result.conflictReason).includes(text)) {
        throw new Error(`reason "${result.conflictReason}" lacks "${text}"`);
      }
      eq(calls.raw.length, 0, 'no code issued');
      eq(calls.created, null, 'no insert');
    });
  }

  await assert(
    'update: code in payload is never written; letter derives facilityType',
    async () => {
      const { db, calls } = fakeDb({ current: { ncdaTypeCode: null, facilityType: null } });
      const result = await service(db).apply({
        ...createOp({ code: 'CLIENT-CODE', ncdaTypeCode: 'E', startYear: 2018 }),
        entityId: 'center-1',
        operation: 'update' as never,
      });
      eq(result.status, SyncOperationStatus.applied);
      eq('code' in calls.updated!, false, 'code not in update');
      eq(calls.updated!.ncdaTypeCode, 'E');
      eq(calls.updated!.facilityType, 'ecd_3_5');
      eq(calls.updated!.startYear, 2018);
    },
  );

  await assert('update: facilityType contradicting coded letter fails without write', async () => {
    const { db, calls } = fakeDb({ current: { ncdaTypeCode: 'B', facilityType: 'home_based' } });
    const result = await service(db).apply({
      ...createOp({ facilityType: 'daycare' }),
      entityId: 'center-1',
      operation: 'update' as never,
    });
    eq(result.status, SyncOperationStatus.failed);
    eq(calls.updated, null);
  });

  console.log('\nAll sync ecd_center tests passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

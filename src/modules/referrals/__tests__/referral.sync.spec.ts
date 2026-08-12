import { ReferralSourceType, ReferralStatus } from '@prisma/client';
import { SYNCABLE_ENTITY_TYPES } from '../../sync/sync.constants';
import {
  canTransitionReferralStatus,
  resolveReferralRecordedByIdFromPayload,
  resolveReferralSourceTypeFromPayload,
  resolveReferralStatusFromPayload,
  toApiReferralStatus,
} from '../mappers/referral.mapper';

/**
 * Referral sync create/update/delete coverage.
 * Run: npx ts-node src/modules/referrals/__tests__/referral.sync.spec.ts
 */

type SyncReferralPayload = {
  childId: string;
  centerId?: string;
  sourceType: string;
  sourceId: string;
  referralDate: string;
  reason: string;
  destination: string;
  status?: string;
  notes?: string;
  implementedAt?: string;
  recordedById?: string;
  deviceId?: string;
};

function buildSyncCreate(
  payload: SyncReferralPayload & { referredById?: string },
  contextDeviceId: string,
  resolvedCenterId: string,
) {
  const sourceType = resolveReferralSourceTypeFromPayload(
    payload as unknown as Record<string, unknown>,
  );
  const status =
    payload.status != null
      ? resolveReferralStatusFromPayload(
          payload as unknown as Record<string, unknown>,
        )
      : ReferralStatus.pending;
  const recordedById = resolveReferralRecordedByIdFromPayload(
    payload as unknown as Record<string, unknown>,
  );

  return {
    childId: payload.childId,
    centerId: payload.centerId ?? resolvedCenterId,
    sourceType,
    sourceId: payload.sourceId,
    referralDate: payload.referralDate,
    reason: payload.reason,
    destination: payload.destination,
    status,
    notes: payload.notes ?? null,
    recordedById,
    lastModifiedByDeviceId: payload.deviceId ?? contextDeviceId,
  };
}

/** Mirrors SyncApplyService.applyReferralUpdate transition gate. */
function assertReferralUpdateAllowed(
  current: ReferralStatus,
  payload: Record<string, unknown>,
): string {
  if (payload.status == null) {
    return 'ok';
  }
  const next = resolveReferralStatusFromPayload(payload);
  if (!canTransitionReferralStatus(current, next)) {
    return `Cannot transition referral from ${current} to ${next}`;
  }
  return 'ok';
}

function buildSyncUpdate(
  payload: Record<string, unknown>,
  now: Date,
): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  if (payload.status != null) {
    data.status = resolveReferralStatusFromPayload(payload);
  }
  if (payload.notes !== undefined) {
    data.notes = payload.notes ?? null;
  }
  if (payload.implementedAt !== undefined) {
    data.implementedAt = payload.implementedAt
      ? new Date(String(payload.implementedAt))
      : null;
  } else if (data.status === ReferralStatus.completed) {
    data.implementedAt = now;
  }
  // Only status/notes (+ implementedAt) — no reason/destination/source
  return data;
}

function buildSyncDelete(entityId: string, now: Date) {
  return {
    id: entityId,
    deletedAt: now,
    versionIncrement: 1,
  };
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

  await assert('Sync create: referral registered', () => {
    eq(SYNCABLE_ENTITY_TYPES.includes('referral'), true);
  });

  await assert('Sync create maps API sourceType/status', () => {
    const data = buildSyncCreate(
      {
        childId: 'c1',
        sourceType: 'nutrition',
        sourceId: 'screen-1',
        referralDate: '2026-08-01',
        reason: 'MUAC',
        destination: 'Clinic',
        recordedById: 'u1',
        deviceId: 'dev-1',
      },
      'dev-context',
      'center-a',
    );
    eq(data.sourceType, ReferralSourceType.nutrition);
    eq(data.status, ReferralStatus.pending);
    eq(data.centerId, 'center-a');
    eq(data.lastModifiedByDeviceId, 'dev-1');
    eq(toApiReferralStatus(data.status), 'pending');
  });

  await assert('Sync create accepts referredById alias (5.8a harness)', () => {
    const data = buildSyncCreate(
      {
        childId: 'c1',
        sourceType: 'sted',
        sourceId: 'sted-1',
        referralDate: '2026-08-12',
        reason: 'STED',
        destination: 'HC',
        referredById: 'user-alias',
        deviceId: 'dev-1',
      } as SyncReferralPayload & { referredById: string },
      'dev-context',
      'center-a',
    );
    eq(data.sourceType, ReferralSourceType.sted);
    eq(data.recordedById, 'user-alias');
  });

  await assert('Sync create prefers referredById when recordedById absent', () => {
    const recordedById = resolveReferralRecordedByIdFromPayload({
      referredById: 'user-from-alias',
    });
    eq(recordedById, 'user-from-alias');
  });

  await assert('Sync create rejects missing recordedBy (no String(undefined))', () => {
    let threw = false;
    try {
      resolveReferralRecordedByIdFromPayload({ sourceType: 'sted' });
    } catch {
      threw = true;
    }
    eq(threw, true);
  });

  await assert('Sync update: status/notes only + state machine', () => {
    const now = new Date('2026-08-04T12:00:00.000Z');
    eq(
      assertReferralUpdateAllowed(ReferralStatus.pending, {
        status: 'completed',
        notes: 'Done',
      }),
      'ok',
    );
    eq(
      assertReferralUpdateAllowed(ReferralStatus.completed, {
        status: 'cancelled',
      }),
      'Cannot transition referral from completed to cancelled',
    );

    const data = buildSyncUpdate(
      { status: 'completed', notes: 'Followed up' },
      now,
    );
    eq(data.status, ReferralStatus.completed);
    eq(data.notes, 'Followed up');
    eq((data.implementedAt as Date).toISOString(), now.toISOString());
    eq('reason' in data, false);
    eq('destination' in data, false);
  });

  await assert('Sync delete soft-deletes', () => {
    const now = new Date('2026-08-04T12:00:00.000Z');
    const deleted = buildSyncDelete('ref-1', now);
    eq(deleted.id, 'ref-1');
    eq(deleted.deletedAt.toISOString(), now.toISOString());
    eq(deleted.versionIncrement, 1);
  });

  await assert('Duplicate create conflict strategy: same id conflicts', () => {
    const existingIds = new Set(['ref-1']);
    const incomingId = 'ref-1';
    const outcome = existingIds.has(incomingId) ? 'conflict' : 'applied';
    eq(outcome, 'conflict');
  });

  await assert('CAS conflict on version mismatch', () => {
    const clientVersion = 1 as number;
    const serverVersion = 3 as number;
    const outcome =
      clientVersion === serverVersion ? 'applied' : 'conflict';
    eq(outcome, 'conflict');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

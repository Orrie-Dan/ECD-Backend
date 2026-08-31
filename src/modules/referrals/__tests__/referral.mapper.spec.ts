import { ReferralSourceType, ReferralStatus } from '@prisma/client';
import {
  canTransitionReferralStatus,
  referralMapper,
  resolveReferralRecordedByIdFromPayload,
  resolveReferralSourceTypeFromPayload,
  resolveReferralStatusFromPayload,
  toApiReferralSourceType,
  toApiReferralStatus,
  toDbReferralSourceType,
  toDbReferralStatus,
} from '../mappers/referral.mapper';

/**
 * Referral mapper tests.
 * Run: npx ts-node src/modules/referrals/__tests__/referral.mapper.spec.ts
 */

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
      throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
  };

  await assert('Mapper enum conversion: status', () => {
    eq(toApiReferralStatus(ReferralStatus.pending), 'pending');
    eq(toApiReferralStatus(ReferralStatus.completed), 'completed');
    eq(toApiReferralStatus(ReferralStatus.cancelled), 'cancelled');
    eq(toDbReferralStatus('pending'), ReferralStatus.pending);
    eq(toDbReferralStatus('completed'), ReferralStatus.completed);
    eq(toDbReferralStatus('cancelled'), ReferralStatus.cancelled);
  });

  await assert('Mapper enum conversion: sourceType', () => {
    eq(toApiReferralSourceType(ReferralSourceType.nutrition), 'nutrition');
    eq(toApiReferralSourceType(ReferralSourceType.sted), 'sted');
    eq(toDbReferralSourceType('nutrition'), ReferralSourceType.nutrition);
    eq(toDbReferralSourceType('sted'), ReferralSourceType.sted);
  });

  await assert('toDto maps via API enums (not Prisma exposure)', () => {
    const now = new Date('2026-08-04T12:00:00.000Z');
    const dto = referralMapper.toDto({
      id: 'ref-1',
      childId: 'child-1',
      centerId: 'center-a',
      sourceType: ReferralSourceType.nutrition,
      sourceTypeId: null,
      sourceId: 'screen-1',
      referralDate: new Date('2026-08-01T00:00:00.000Z'),
      reason: 'MUAC severe',
      destination: 'Health center',
      status: ReferralStatus.pending,
      statusId: null,
      implementedAt: null,
      notes: null,
      recordedById: 'user-1',
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      version: 1,
      syncStatus: 'synced' as never,
      lastModifiedByDeviceId: null,
      lastModifiedAt: now,
    });
    eq(dto.status, 'pending');
    eq(dto.sourceType, 'nutrition');
    eq(dto.referralDate, '2026-08-01');
    eq(dto.recordedBy, 'user-1');
  });

  await assert('State machine: pending → completed/cancelled', () => {
    eq(canTransitionReferralStatus(ReferralStatus.pending, ReferralStatus.completed), true);
    eq(canTransitionReferralStatus(ReferralStatus.pending, ReferralStatus.cancelled), true);
    eq(canTransitionReferralStatus(ReferralStatus.completed, ReferralStatus.cancelled), false);
    eq(canTransitionReferralStatus(ReferralStatus.cancelled, ReferralStatus.pending), false);
  });

  await assert('Sync payload resolves API or Prisma enums', () => {
    eq(resolveReferralSourceTypeFromPayload({ sourceType: 'sted' }), ReferralSourceType.sted);
    eq(resolveReferralStatusFromPayload({ status: 'completed' }), ReferralStatus.completed);
  });

  await assert('Sync payload resolves recordedBy aliases', () => {
    eq(resolveReferralRecordedByIdFromPayload({ recordedById: 'u1' }), 'u1');
    eq(resolveReferralRecordedByIdFromPayload({ recordedBy: 'u2' }), 'u2');
    eq(resolveReferralRecordedByIdFromPayload({ referredById: 'u3' }), 'u3');
  });

  await assert('Sync payload rejects missing/sentinel recordedBy', () => {
    let missing = false;
    try {
      resolveReferralRecordedByIdFromPayload({});
    } catch {
      missing = true;
    }
    eq(missing, true);

    let sentinel = false;
    try {
      resolveReferralRecordedByIdFromPayload({ recordedById: 'undefined' });
    } catch {
      sentinel = true;
    }
    eq(sentinel, true);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

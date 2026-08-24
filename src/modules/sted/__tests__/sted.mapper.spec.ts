import { StedAgeBand } from '@prisma/client';
import {
  extractStedReferralSignals,
  resolveStedAgeBandFromPayload,
  stedMapper,
  toApiAgeBand,
  toDbAgeBand,
} from '../mappers/sted.mapper';

/**
 * STED mapper tests.
 * Run: npx ts-node src/modules/sted/__tests__/sted.mapper.spec.ts
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

  await assert('Mapper ageBand conversion 1_3 ↔ band_1_3', () => {
    eq(toDbAgeBand('1_3'), StedAgeBand.band_1_3);
    eq(toApiAgeBand(StedAgeBand.band_1_3), '1_3');
  });

  await assert('Mapper ageBand conversion 4_6 ↔ band_4_6', () => {
    eq(toDbAgeBand('4_6'), StedAgeBand.band_4_6);
    eq(toApiAgeBand(StedAgeBand.band_4_6), '4_6');
  });

  await assert('toDto never exposes Prisma ageBand enum', () => {
    const now = new Date('2026-08-01T10:00:00.000Z');
    const dto = stedMapper.toDto({
      id: 'sted-1',
      childId: 'child-1',
      centerId: 'center-1',
      assessmentDate: new Date('2026-08-01T00:00:00.000Z'),
      ageBand: StedAgeBand.band_1_3,
      consentObtained: true,
      physicalAssessment: { hearing: 'ok' },
      milestoneResults: { walk: true },
      outcome: { referred: false },
      followUpIn6Months: false,
      followUpDueDate: null,
      notes: null,
      assessedById: 'user-1',
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      version: 1,
      syncStatus: 'synced' as never,
      lastModifiedByDeviceId: null,
      lastModifiedAt: now,
    });

    eq(dto.ageBand, '1_3');
    eq(dto.assessedBy, 'user-1');
    eq(dto.assessmentDate, '2026-08-01');
    eq('assessedById' in dto, false);
    eq(JSON.stringify(dto).includes('band_1_3'), false);
  });

  await assert('invalid ageBand rejected by resolver', () => {
    let threw = false;
    try {
      resolveStedAgeBandFromPayload({ ageBand: '2_5' });
    } catch {
      threw = true;
    }
    eq(threw, true);
  });

  await assert('referral signals extracted without creating referrals', () => {
    const signals = extractStedReferralSignals({
      physicalAssessment: { problems: ['vision'] },
      milestoneResults: { failed: ['speech'] },
      outcome: { referred: true },
    });
    eq(signals.referred, true);
    eq(signals.hasPhysicalProblems, true);
    eq(signals.hasFailedMilestones, true);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

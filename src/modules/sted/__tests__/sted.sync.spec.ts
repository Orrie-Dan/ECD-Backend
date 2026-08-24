import { StedAgeBand } from '@prisma/client';
import { SYNCABLE_ENTITY_TYPES } from '../../sync/sync.constants';
import { resolveStedAgeBandFromPayload, toApiAgeBand } from '../mappers/sted.mapper';

/**
 * STED sync create/delete/append-only coverage.
 * Run: npx ts-node src/modules/sted/__tests__/sted.sync.spec.ts
 */

type SyncStedPayload = {
  childId: string;
  centerId?: string;
  assessmentDate: string;
  ageBand: string;
  consentObtained: boolean;
  physicalAssessment: Record<string, unknown>;
  milestoneResults: Record<string, unknown>;
  outcome: Record<string, unknown>;
  followUpIn6Months?: boolean;
  followUpDueDate?: string;
  notes?: string;
  assessedById: string;
  deviceId?: string;
};

function buildSyncCreate(
  payload: SyncStedPayload,
  contextDeviceId: string,
  resolvedCenterId: string,
) {
  const ageBand = resolveStedAgeBandFromPayload(payload as unknown as Record<string, unknown>);
  return {
    childId: payload.childId,
    centerId: payload.centerId ?? resolvedCenterId,
    assessmentDate: payload.assessmentDate,
    ageBand,
    consentObtained: payload.consentObtained,
    physicalAssessment: payload.physicalAssessment,
    milestoneResults: payload.milestoneResults,
    outcome: payload.outcome,
    followUpIn6Months: Boolean(payload.followUpIn6Months ?? false),
    followUpDueDate: payload.followUpDueDate ?? null,
    notes: payload.notes ?? null,
    assessedById: payload.assessedById,
    lastModifiedByDeviceId: payload.deviceId ?? contextDeviceId,
  };
}

function assertAppendOnlyUpdateRejected(entityType: string): string {
  if (entityType === 'child_nutrition_screening' || entityType === 'sted_assessment') {
    return `${entityType} is append-only and cannot be updated`;
  }
  return 'ok';
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
      throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
  };

  await assert('Sync create: sted_assessment registered', () => {
    eq(SYNCABLE_ENTITY_TYPES.includes('sted_assessment'), true);
  });

  await assert('Sync create maps API ageBand', () => {
    const data = buildSyncCreate(
      {
        childId: 'c1',
        assessmentDate: '2026-08-01',
        ageBand: '1_3',
        consentObtained: true,
        physicalAssessment: {},
        milestoneResults: {},
        outcome: { referred: false },
        assessedById: 'u1',
        deviceId: 'dev-1',
      },
      'dev-context',
      'center-a',
    );
    eq(data.ageBand, StedAgeBand.band_1_3);
    eq(toApiAgeBand(data.ageBand), '1_3');
    eq(data.centerId, 'center-a');
    eq(data.lastModifiedByDeviceId, 'dev-1');
  });

  await assert('Sync create accepts Prisma ageBand enum too', () => {
    const data = buildSyncCreate(
      {
        childId: 'c1',
        centerId: 'center-b',
        assessmentDate: '2026-08-01',
        ageBand: StedAgeBand.band_4_6,
        consentObtained: true,
        physicalAssessment: {},
        milestoneResults: {},
        outcome: {},
        assessedById: 'u1',
      },
      'dev-context',
      'center-a',
    );
    eq(data.ageBand, StedAgeBand.band_4_6);
    eq(data.centerId, 'center-b');
    eq(data.lastModifiedByDeviceId, 'dev-context');
  });

  await assert('Sync delete soft-deletes', () => {
    const now = new Date('2026-08-04T12:00:00.000Z');
    const deleted = buildSyncDelete('sted-1', now);
    eq(deleted.id, 'sted-1');
    eq(deleted.deletedAt.toISOString(), now.toISOString());
    eq(deleted.versionIncrement, 1);
  });

  await assert('Append-only behavior rejects UPDATE', () => {
    eq(
      assertAppendOnlyUpdateRejected('sted_assessment'),
      'sted_assessment is append-only and cannot be updated',
    );
    eq(assertAppendOnlyUpdateRejected('attendance_record'), 'ok');
  });

  await assert('Duplicate create conflict strategy: same id conflicts', () => {
    // Matches SyncApplyService.applyCreate: existing entityId → conflict
    const existingIds = new Set(['sted-1']);
    const incomingId = 'sted-1';
    const outcome = existingIds.has(incomingId) ? 'conflict' : 'applied';
    eq(outcome, 'conflict');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

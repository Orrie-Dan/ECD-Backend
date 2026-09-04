import { NutritionStatus } from '../../../common/domain';
import { deriveRequiresReferral } from '../mappers/nutrition.mapper';

/**
 * Nutrition sync payload field coverage.
 * Run: npx ts-node src/modules/nutrition/__tests__/nutrition.sync.spec.ts
 */

type SyncNutritionPayload = {
  childId: string;
  screeningDate: string;
  weightKg: number;
  muacCm: number;
  heightCm?: number;
  headCircumferenceCm?: number;
  nutritionStatus: NutritionStatus;
  requiresReferral?: boolean;
  deviceId?: string;
  mealQuality?: string;
  feedingConcern?: boolean;
  dietNotes?: string;
  recordedById: string;
};

function buildSyncCreateData(payload: SyncNutritionPayload, contextDeviceId: string) {
  const requiresReferral = deriveRequiresReferral(
    payload.nutritionStatus,
    payload.requiresReferral,
  );

  return {
    childId: payload.childId,
    screeningDate: payload.screeningDate,
    weightKg: payload.weightKg,
    muacCm: payload.muacCm,
    heightCm: payload.heightCm ?? null,
    headCircumferenceCm: payload.headCircumferenceCm ?? null,
    nutritionStatus: payload.nutritionStatus,
    requiresReferral,
    mealQuality: payload.mealQuality ?? null,
    feedingConcern: Boolean(payload.feedingConcern ?? false),
    dietNotes: payload.dietNotes ?? null,
    recordedById: payload.recordedById,
    lastModifiedByDeviceId: payload.deviceId ?? contextDeviceId,
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

  await assert('sync payload contains new nutrition fields', () => {
    const data = buildSyncCreateData(
      {
        childId: 'c1',
        screeningDate: '2026-08-01',
        weightKg: 10.2,
        muacCm: 13.5,
        heightCm: 74.1,
        headCircumferenceCm: 46.2,
        nutritionStatus: NutritionStatus.moderate,
        requiresReferral: false,
        deviceId: 'device-9',
        recordedById: 'user-1',
      },
      'device-context',
    );

    eq(data.heightCm, 74.1);
    eq(data.headCircumferenceCm, 46.2);
    eq(data.requiresReferral, true);
    eq(data.nutritionStatus, NutritionStatus.moderate);
    eq(data.lastModifiedByDeviceId, 'device-9');
  });

  await assert('sync falls back to context deviceId', () => {
    const data = buildSyncCreateData(
      {
        childId: 'c1',
        screeningDate: '2026-08-01',
        weightKg: 10,
        muacCm: 13,
        nutritionStatus: NutritionStatus.normal,
        recordedById: 'user-1',
      },
      'device-context',
    );
    eq(data.lastModifiedByDeviceId, 'device-context');
    eq(data.heightCm, null);
    eq(data.requiresReferral, false);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run();

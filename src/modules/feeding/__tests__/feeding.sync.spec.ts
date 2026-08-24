import { SYNCABLE_ENTITY_TYPES } from '../../sync/sync.constants';

/**
 * Feeding sync coverage tests.
 * Run: npx ts-node src/modules/feeding/__tests__/feeding.sync.spec.ts
 */

type FeedingDayPayload = {
  centerId: string;
  recordedDate: string;
  milkServed: boolean;
  porridgeServed: boolean;
  balancedMealServed: boolean;
  cerealsOrTubers: boolean;
  legumes: boolean;
  dairy: boolean;
  animalProducts: boolean;
  fruitsVegetables: boolean;
  addedFat: boolean;
  recordedById: string;
  deviceId?: string;
};

type FeedingMonthPayload = {
  centerId: string;
  yearMonth: string;
  milkLiters: number;
  flourKg: number;
  foodSource: string;
  updatedById: string;
  deviceId?: string;
};

function buildDayCreate(payload: FeedingDayPayload, contextDeviceId: string) {
  return {
    centerId: payload.centerId,
    recordedDate: payload.recordedDate,
    milkServed: payload.milkServed,
    porridgeServed: payload.porridgeServed,
    balancedMealServed: payload.balancedMealServed,
    cerealsOrTubers: payload.cerealsOrTubers,
    legumes: payload.legumes,
    dairy: payload.dairy,
    animalProducts: payload.animalProducts,
    fruitsVegetables: payload.fruitsVegetables,
    addedFat: payload.addedFat,
    recordedById: payload.recordedById,
    lastModifiedByDeviceId: payload.deviceId ?? contextDeviceId,
  };
}

function buildMonthUpdate(payload: Partial<FeedingMonthPayload>, existing: FeedingMonthPayload) {
  return {
    ...existing,
    ...payload,
    milkLiters: payload.milkLiters ?? existing.milkLiters,
    flourKg: payload.flourKg ?? existing.flourKg,
    foodSource: payload.foodSource ?? existing.foodSource,
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

  await assert('sync registry includes feeding entities', () => {
    eq(SYNCABLE_ENTITY_TYPES.includes('center_feeding_day'), true);
    eq(SYNCABLE_ENTITY_TYPES.includes('center_feeding_month_summary'), true);
  });

  await assert('sync create day payload', () => {
    const data = buildDayCreate(
      {
        centerId: 'c1',
        recordedDate: '2026-08-01',
        milkServed: true,
        porridgeServed: false,
        balancedMealServed: true,
        cerealsOrTubers: true,
        legumes: true,
        dairy: true,
        animalProducts: true,
        fruitsVegetables: true,
        addedFat: false,
        recordedById: 'u1',
        deviceId: 'dev-1',
      },
      'dev-context',
    );
    eq(data.lastModifiedByDeviceId, 'dev-1');
    eq(data.cerealsOrTubers, true);
    eq(data.addedFat, false);
  });

  await assert('sync update month payload merges fields', () => {
    const updated = buildMonthUpdate(
      { milkLiters: 50, foodSource: 'market' },
      {
        centerId: 'c1',
        yearMonth: '2026-08',
        milkLiters: 10,
        flourKg: 5,
        foodSource: 'donation',
        updatedById: 'u1',
      },
    );
    eq(updated.milkLiters, 50);
    eq(updated.flourKg, 5);
    eq(updated.foodSource, 'market');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run();

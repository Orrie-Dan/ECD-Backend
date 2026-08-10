import { NutritionStatus, Prisma } from '@prisma/client';
import {
  decimalToNumber,
  deriveRequiresReferral,
  nutritionMapper,
} from '../mappers/nutrition.mapper';

/**
 * Nutrition mapper tests.
 * Run: npx ts-node src/modules/nutrition/__tests__/nutrition.mapper.spec.ts
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
      throw new Error(
        `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
      );
    }
  };

  await assert('Decimal mapping to number', () => {
    eq(decimalToNumber(new Prisma.Decimal('12.450')), 12.45);
    eq(decimalToNumber(null), null);
    eq(decimalToNumber(undefined), null);
    eq(decimalToNumber(10), 10);
  });

  await assert('optional fields map to null', () => {
    const dto = nutritionMapper.toDto({
      id: 's1',
      childId: 'c1',
      screeningDate: new Date('2026-08-01'),
      weightKg: new Prisma.Decimal('10.5'),
      muacCm: new Prisma.Decimal('13.2'),
      heightCm: null,
      headCircumferenceCm: null,
      nutritionStatus: NutritionStatus.normal,
      requiresReferral: false,
      mealQuality: null,
      feedingConcern: false,
      dietNotes: null,
      recordedById: 'u1',
      createdAt: new Date('2026-08-01'),
      deletedAt: null,
      version: 1,
      syncStatus: 'synced' as never,
      lastModifiedByDeviceId: null,
      lastModifiedAt: new Date('2026-08-01'),
    });

    eq(dto.heightCm, null);
    eq(dto.headCircumferenceCm, null);
    eq(dto.mealQuality, null);
    eq(dto.dietNotes, null);
    eq(dto.weightKg, 10.5);
    eq(dto.muacCm, 13.2);
  });

  await assert('enum mapping preserved', () => {
    const dto = nutritionMapper.toDto({
      id: 's1',
      childId: 'c1',
      screeningDate: new Date('2026-08-01'),
      weightKg: new Prisma.Decimal('8'),
      muacCm: new Prisma.Decimal('11'),
      heightCm: new Prisma.Decimal('75'),
      headCircumferenceCm: new Prisma.Decimal('45'),
      nutritionStatus: NutritionStatus.severe,
      requiresReferral: true,
      mealQuality: 'poor',
      feedingConcern: true,
      dietNotes: 'note',
      recordedById: 'u1',
      createdAt: new Date('2026-08-01'),
      deletedAt: null,
      version: 1,
      syncStatus: 'synced' as never,
      lastModifiedByDeviceId: null,
      lastModifiedAt: new Date('2026-08-01'),
    });

    eq(dto.nutritionStatus, NutritionStatus.severe);
    eq(dto.requiresReferral, true);
    eq(dto.heightCm, 75);
    eq(dto.headCircumferenceCm, 45);
  });

  await assert('referral flag: moderate/severe force true', () => {
    eq(deriveRequiresReferral(NutritionStatus.moderate, false), true);
    eq(deriveRequiresReferral(NutritionStatus.severe, false), true);
    eq(deriveRequiresReferral(NutritionStatus.normal, false), false);
    eq(deriveRequiresReferral(NutritionStatus.at_risk, true), true);
    eq(deriveRequiresReferral(NutritionStatus.normal, true), true);
  });

  await assert('growth chart chronological order', () => {
    const chart = nutritionMapper.toGrowthChart('c1', [
      {
        id: 's2',
        childId: 'c1',
        screeningDate: new Date('2026-08-10'),
        weightKg: new Prisma.Decimal('11'),
        muacCm: new Prisma.Decimal('14'),
        heightCm: null,
        headCircumferenceCm: null,
        nutritionStatus: NutritionStatus.normal,
        requiresReferral: false,
        mealQuality: null,
        feedingConcern: false,
        dietNotes: null,
        recordedById: 'u1',
        createdAt: new Date(),
        deletedAt: null,
        version: 1,
        syncStatus: 'synced' as never,
        lastModifiedByDeviceId: null,
        lastModifiedAt: new Date(),
      },
      {
        id: 's1',
        childId: 'c1',
        screeningDate: new Date('2026-08-01'),
        weightKg: new Prisma.Decimal('10'),
        muacCm: new Prisma.Decimal('13'),
        heightCm: new Prisma.Decimal('70'),
        headCircumferenceCm: null,
        nutritionStatus: NutritionStatus.normal,
        requiresReferral: false,
        mealQuality: null,
        feedingConcern: false,
        dietNotes: null,
        recordedById: 'u1',
        createdAt: new Date(),
        deletedAt: null,
        version: 1,
        syncStatus: 'synced' as never,
        lastModifiedByDeviceId: null,
        lastModifiedAt: new Date(),
      },
    ]);

    eq(chart.weight.length, 2);
    eq(chart.weight[0].value, 10);
    eq(chart.weight[1].value, 11);
    eq(chart.height.length, 1);
    eq(chart.height[0].value, 70);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run();

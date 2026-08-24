import {
  balancedMealWarnings,
  decimalToNumber,
  feedingMapper,
  resolveFeedingRecordedByIdFromPayload,
  resolveFeedingRecordedDateFromPayload,
} from '../mappers/feeding.mapper';
import { Prisma } from '@prisma/client';

/**
 * Feeding mapper tests.
 * Run: npx ts-node src/modules/feeding/__tests__/feeding.mapper.spec.ts
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

  await assert('Decimal mapping', () => {
    eq(decimalToNumber(new Prisma.Decimal('12.5')), 12.5);
    eq(decimalToNumber(null), 0);
  });

  await assert('balanced meal warning when incomplete', () => {
    const warnings = balancedMealWarnings({
      balancedMealServed: true,
      cerealsOrTubers: true,
      legumes: true,
      dairy: false,
      animalProducts: true,
      fruitsVegetables: true,
      addedFat: true,
    });
    eq(warnings.length, 1);
    eq(warnings[0].includes('dairy'), true);
  });

  await assert('no warning when balanced complete or false', () => {
    eq(
      balancedMealWarnings({
        balancedMealServed: false,
        cerealsOrTubers: false,
        legumes: false,
        dairy: false,
        animalProducts: false,
        fruitsVegetables: false,
        addedFat: false,
      }).length,
      0,
    );
    eq(
      balancedMealWarnings({
        balancedMealServed: true,
        cerealsOrTubers: true,
        legumes: true,
        dairy: true,
        animalProducts: true,
        fruitsVegetables: true,
        addedFat: true,
      }).length,
      0,
    );
  });

  await assert('day mapper DTO fields', () => {
    const dto = feedingMapper.toDto(
      {
        id: 'f1',
        centerId: 'c1',
        recordedDate: new Date('2026-08-01'),
        milkServed: true,
        porridgeServed: false,
        balancedMealServed: true,
        cerealsOrTubers: true,
        legumes: true,
        dairy: true,
        animalProducts: true,
        fruitsVegetables: true,
        addedFat: true,
        recordedById: 'u1',
        createdAt: new Date('2026-08-01T10:00:00Z'),
        updatedAt: new Date('2026-08-01T10:00:00Z'),
        deletedAt: null,
        version: 1,
        syncStatus: 'synced' as never,
        lastModifiedByDeviceId: null,
        lastModifiedAt: new Date(),
      },
      ['warn'],
    );
    eq(dto.recordedBy, 'u1');
    eq(dto.warnings[0], 'warn');
    eq(dto.milkServed, true);
  });

  await assert('month mapper converts decimals', () => {
    const dto = feedingMapper.toMonthDto({
      id: 'm1',
      centerId: 'c1',
      yearMonth: '2026-08',
      milkLiters: new Prisma.Decimal('120.5'),
      flourKg: new Prisma.Decimal('40'),
      foodSource: 'local',
      createdAt: new Date(),
      updatedAt: new Date('2026-08-02'),
      updatedById: 'u2',
      deletedAt: null,
      version: 2,
      syncStatus: 'synced' as never,
      lastModifiedByDeviceId: null,
      lastModifiedAt: new Date(),
    });
    eq(dto.milkLiters, 120.5);
    eq(dto.flourKg, 40);
    eq(dto.recordedBy, 'u2');
    eq(dto.yearMonth, '2026-08');
  });

  await assert('resolveFeedingRecordedDateFromPayload prefers recordedDate', () => {
    const d = resolveFeedingRecordedDateFromPayload({
      recordedDate: '2026-08-04',
      date: '2026-08-01',
    });
    eq(d.toISOString().slice(0, 10), '2026-08-04');
  });

  await assert('resolveFeedingRecordedDateFromPayload accepts date alias', () => {
    const d = resolveFeedingRecordedDateFromPayload({ date: '2026-08-05' });
    eq(d.toISOString().slice(0, 10), '2026-08-05');
  });

  await assert('resolveFeedingRecordedDateFromPayload rejects missing', () => {
    try {
      resolveFeedingRecordedDateFromPayload({});
      throw new Error('expected throw');
    } catch (err) {
      if (!(err instanceof Error) || !err.message.includes('recordedDate')) {
        throw err;
      }
    }
  });

  await assert('resolveFeedingRecordedByIdFromPayload accepts aliases', () => {
    eq(resolveFeedingRecordedByIdFromPayload({ recordedById: 'u1' }), 'u1');
    eq(resolveFeedingRecordedByIdFromPayload({ recordedBy: 'u2' }), 'u2');
  });

  await assert('resolveFeedingRecordedByIdFromPayload rejects sentinel undefined', () => {
    try {
      resolveFeedingRecordedByIdFromPayload({ recordedById: 'undefined' });
      throw new Error('expected throw');
    } catch (err) {
      if (!(err instanceof Error) || !err.message.includes('recordedById')) {
        throw err;
      }
    }
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run();

import { ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { AuthUser } from '../../auth/interfaces/jwt-payload.interface';
import { createMockLookupResolver } from '../../../common/lookups/lookup-resolver.mock';
import { FeedingService } from '../feeding.service';
import { UpsertFeedingDayDto } from '../dto/upsert-feeding-day.dto';

/**
 * Feeding service tests (mocked Prisma).
 * Run: npx ts-node src/modules/feeding/__tests__/feeding.service.spec.ts
 */

function user(partial: Partial<AuthUser> & Pick<AuthUser, 'role'>): AuthUser {
  return {
    id: partial.id ?? 'user-1',
    username: 'user',
    email: null,
    fullName: 'User',
    role: partial.role,
    centerId: partial.centerId ?? null,
    districtId: partial.districtId ?? null,
    status: 'active',
  };
}

function baseDayDto(overrides: Partial<UpsertFeedingDayDto> = {}): UpsertFeedingDayDto {
  return {
    centerId: 'center-a',
    recordedDate: '2026-08-01',
    milkServed: true,
    porridgeServed: true,
    balancedMealServed: false,
    cerealsOrTubers: false,
    legumes: false,
    dairy: false,
    animalProducts: false,
    fruitsVegetables: false,
    addedFat: false,
    ...overrides,
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

  await assert('update daily when exists', async () => {
    let updated = false;
    const prisma = {
      ecdCenter: {
        findFirst: async () => ({ id: 'center-a', districtId: 'd1' }),
      },
      device: { findUnique: async () => null },
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          centerFeedingDay: {
            findFirst: async () => ({
              id: 'day-1',
              centerId: 'center-a',
              recordedDate: new Date('2026-08-01'),
              version: 1,
            }),
            updateMany: async ({
              where,
              data,
            }: {
              where: { version: number };
              data: Record<string, unknown>;
            }) => {
              updated = true;
              eq(where.version, 1);
              return { count: 1 };
            },
            findFirstOrThrow: async () => ({
              id: 'day-1',
              centerId: 'center-a',
              recordedDate: new Date('2026-08-01'),
              milkServed: false,
              porridgeServed: true,
              balancedMealServed: false,
              cerealsOrTubers: false,
              legumes: false,
              dairy: false,
              animalProducts: false,
              fruitsVegetables: false,
              addedFat: false,
              recordedById: 'user-1',
              createdAt: new Date('2026-08-01'),
              updatedAt: new Date(),
              deletedAt: null,
              version: 2,
              syncStatus: 'synced',
              lastModifiedByDeviceId: null,
              lastModifiedAt: new Date(),
            }),
            findUnique: async () => ({ version: 2 }),
          },
        }),
    };

    const result = await new FeedingService(
      prisma as never,
      { log: async () => {} } as never,
      createMockLookupResolver(),
    ).upsertDaily(
      user({ role: UserRole.caregiver, centerId: 'center-a', districtId: 'd1' }),
      baseDayDto({ milkServed: false, version: 1 }),
    );
    eq(updated, true);
    eq(result.id, 'day-1');
    eq(result.milkServed, false);
    eq(result.version, 2);
  });

  await assert('stale daily update conflicts', async () => {
    const { OptimisticLockConflictException } =
      await import('../../../common/concurrency/optimistic-lock.exception');
    const prisma = {
      ecdCenter: {
        findFirst: async () => ({ id: 'center-a', districtId: 'd1' }),
      },
      device: { findUnique: async () => null },
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          centerFeedingDay: {
            findFirst: async () => ({
              id: 'day-1',
              version: 6,
            }),
            updateMany: async () => ({ count: 0 }),
            findUnique: async () => ({ version: 6 }),
          },
        }),
    };

    let caught: unknown;
    try {
      await new FeedingService(prisma as never, { log: async () => {} } as never, createMockLookupResolver()).upsertDaily(
        user({
          role: UserRole.caregiver,
          centerId: 'center-a',
          districtId: 'd1',
        }),
        baseDayDto({ version: 5 }),
      );
    } catch (err) {
      caught = err;
    }
    eq(caught instanceof OptimisticLockConflictException, true);
    eq((caught as { currentVersion?: number }).currentVersion, 6);
  });

  await assert('create daily when missing', async () => {
    let created = false;
    const prisma = {
      ecdCenter: {
        findFirst: async () => ({ id: 'center-a', districtId: 'd1' }),
      },
      device: { findUnique: async () => null },
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          centerFeedingDay: {
            findFirst: async () => null,
            create: async ({ data }: { data: Record<string, unknown> }) => {
              created = true;
              return {
                ...data,
                createdAt: new Date(),
                updatedAt: new Date(),
                deletedAt: null,
              };
            },
          },
        }),
    };

    const result = await new FeedingService(
      prisma as never,
      { log: async () => {} } as never,
      createMockLookupResolver(),
    ).upsertDaily(
      user({ role: UserRole.caregiver, centerId: 'center-a', districtId: 'd1' }),
      baseDayDto(),
    );
    eq(created, true);
    eq(result.centerId, 'center-a');
    eq(result.milkServed, true);
  });

  await assert('create monthly summary', async () => {
    let created = false;
    const prisma = {
      ecdCenter: {
        findFirst: async () => ({ id: 'center-a', districtId: 'd1' }),
      },
      device: { findUnique: async () => null },
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          centerFeedingMonthSummary: {
            findFirst: async () => null,
            create: async ({ data }: { data: Record<string, unknown> }) => {
              created = true;
              return {
                ...data,
                createdAt: new Date(),
                updatedAt: new Date(),
                deletedAt: null,
              };
            },
          },
        }),
    };

    const result = await new FeedingService(
      prisma as never,
      { log: async () => {} } as never,
      createMockLookupResolver(),
    ).upsertMonthSummary(
      user({ role: UserRole.caregiver, centerId: 'center-a', districtId: 'd1' }),
      {
        centerId: 'center-a',
        yearMonth: '2026-08',
        milkLiters: 10,
        flourKg: 5,
        foodSource: 'donation',
      },
    );
    eq(created, true);
    eq(result.yearMonth, '2026-08');
    eq(result.milkLiters, 10);
  });

  await assert('update monthly summary', async () => {
    let updated = false;
    const prisma = {
      ecdCenter: {
        findFirst: async () => ({ id: 'center-a', districtId: 'd1' }),
      },
      device: { findUnique: async () => null },
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          centerFeedingMonthSummary: {
            findFirst: async () => ({
              id: 'm1',
              centerId: 'center-a',
              yearMonth: '2026-08',
              version: 2,
            }),
            updateMany: async ({ where }: { where: { version: number } }) => {
              updated = true;
              eq(where.version, 2);
              return { count: 1 };
            },
            findFirstOrThrow: async () => ({
              id: 'm1',
              centerId: 'center-a',
              yearMonth: '2026-08',
              milkLiters: 20,
              flourKg: 8,
              foodSource: 'purchase',
              createdAt: new Date(),
              updatedAt: new Date(),
              updatedById: 'user-1',
              deletedAt: null,
              version: 3,
              syncStatus: 'synced',
              lastModifiedByDeviceId: null,
              lastModifiedAt: new Date(),
            }),
            findUnique: async () => ({ version: 3 }),
          },
        }),
    };

    const result = await new FeedingService(
      prisma as never,
      { log: async () => {} } as never,
      createMockLookupResolver(),
    ).upsertMonthSummary(
      user({ role: UserRole.caregiver, centerId: 'center-a', districtId: 'd1' }),
      {
        centerId: 'center-a',
        yearMonth: '2026-08',
        milkLiters: 20,
        flourKg: 8,
        foodSource: 'purchase',
        version: 2,
      },
    );
    eq(updated, true);
    eq(result.version, 3);
    eq(result.foodSource, 'purchase');
  });

  await assert('authorization rejects other center caregiver', async () => {
    const prisma = {
      ecdCenter: {
        findFirst: async () => ({ id: 'center-b', districtId: 'd1' }),
      },
    };
    let denied = false;
    try {
      await new FeedingService(prisma as never, { log: async () => {} } as never, createMockLookupResolver()).upsertDaily(
        user({
          role: UserRole.caregiver,
          centerId: 'center-a',
          districtId: 'd1',
        }),
        baseDayDto({ centerId: 'center-b' }),
      );
    } catch (err) {
      denied = err instanceof ForbiddenException;
    }
    eq(denied, true);
  });

  await assert('yearMonth validation pattern via DTO regex expectation', () => {
    const valid = /^\d{4}-\d{2}$/.test('2026-08');
    const invalid = /^\d{4}-\d{2}$/.test('2026/08');
    eq(valid, true);
    eq(invalid, false);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run();

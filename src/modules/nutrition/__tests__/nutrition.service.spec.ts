import { ForbiddenException } from '@nestjs/common';
import {
  ChildStatus,
  NutritionStatus,
  Prisma,
  UserRole,
} from '@prisma/client';
import { AuthUser } from '../../auth/interfaces/jwt-payload.interface';
import { SyncAccessService } from '../../sync/sync-access.service';
import { CreateNutritionScreeningDto } from '../dto/create-nutrition-screening.dto';
import { NutritionService } from '../nutrition.service';
import { deriveRequiresReferral } from '../mappers/nutrition.mapper';

/**
 * Nutrition service tests (mocked Prisma).
 * Run: npx ts-node src/modules/nutrition/__tests__/nutrition.service.spec.ts
 */

function user(partial: Partial<AuthUser> & Pick<AuthUser, 'role'>): AuthUser {
  return {
    id: partial.id ?? 'user-1',
    username: partial.username ?? 'user',
    email: null,
    fullName: 'User',
    role: partial.role,
    centerId: partial.centerId ?? null,
    districtId: partial.districtId ?? null,
    status: 'active',
  };
}

function createService(prisma: object, syncAccess?: SyncAccessService) {
  const access =
    syncAccess ??
    ({
      resolveScope: async (u: AuthUser) => {
        if (u.role === UserRole.ncda_admin) {
          return { centerIds: 'all' as const, districtId: null };
        }
        if (u.role === UserRole.district_focal_person) {
          return {
            centerIds: ['center-a', 'center-b'],
            districtId: u.districtId,
          };
        }
        return { centerIds: [u.centerId!], districtId: u.districtId };
      },
    } as SyncAccessService);

  return new NutritionService(prisma as never, access, {
    log: async () => {},
  } as never);
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

  await assert('create screening appends and maps response', async () => {
    const createdRows: unknown[] = [];
    const screeningApi = {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        createdRows.push(data);
        return {
          id: data.id,
          childId: data.childId,
          screeningDate: data.screeningDate,
          weightKg: data.weightKg,
          muacCm: data.muacCm,
          heightCm: data.heightCm ?? null,
          headCircumferenceCm: data.headCircumferenceCm ?? null,
          nutritionStatus: data.nutritionStatus,
          requiresReferral: data.requiresReferral,
          mealQuality: data.mealQuality ?? null,
          feedingConcern: data.feedingConcern ?? false,
          dietNotes: data.dietNotes ?? null,
          recordedById: data.recordedById,
          createdAt: new Date(),
          deletedAt: null,
          version: 1,
          syncStatus: 'synced',
          lastModifiedByDeviceId: data.lastModifiedByDeviceId ?? null,
          lastModifiedAt: new Date(),
        };
      },
    };
    const prisma = {
      child: {
        findFirst: async () => ({
          id: 'child-1',
          centerId: 'center-a',
          status: ChildStatus.active,
          center: { id: 'center-a', districtId: 'd1' },
        }),
      },
      childNutritionScreening: screeningApi,
      device: { findUnique: async () => null },
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({ childNutritionScreening: screeningApi }),
    };

    const svc = createService(prisma);
    const caregiver = user({
      role: UserRole.caregiver,
      centerId: 'center-a',
      districtId: 'd1',
    });

    const dto: CreateNutritionScreeningDto = {
      screeningDate: '2026-08-01',
      weightKg: 10.5,
      muacCm: 13.1,
      nutritionStatus: NutritionStatus.normal,
      heightCm: 72,
    };

    const result = await svc.createScreening(caregiver, 'child-1', dto);
    eq(createdRows.length, 1);
    eq(result.weightKg, 10.5);
    eq(result.heightCm, 72);
    eq(result.nutritionStatus, NutritionStatus.normal);
    eq(result.requiresReferral, false);
  });

  await assert('referral flag forced for severe', async () => {
    let storedRequires: boolean | null = null;
    const screeningApi = {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        storedRequires = data.requiresReferral as boolean;
        return {
          ...data,
          heightCm: null,
          headCircumferenceCm: null,
          mealQuality: null,
          feedingConcern: false,
          dietNotes: null,
          createdAt: new Date(),
          deletedAt: null,
          version: 1,
          syncStatus: 'synced',
          lastModifiedByDeviceId: null,
          lastModifiedAt: new Date(),
        };
      },
    };
    const prisma = {
      child: {
        findFirst: async () => ({
          id: 'child-1',
          centerId: 'center-a',
          status: ChildStatus.active,
          center: { id: 'center-a', districtId: 'd1' },
        }),
      },
      childNutritionScreening: screeningApi,
      device: { findUnique: async () => null },
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({ childNutritionScreening: screeningApi }),
    };

    const svc = createService(prisma);
    await svc.createScreening(
      user({ role: UserRole.caregiver, centerId: 'center-a', districtId: 'd1' }),
      'child-1',
      {
        screeningDate: '2026-08-01',
        weightKg: 7,
        muacCm: 10,
        nutritionStatus: NutritionStatus.severe,
        requiresReferral: false,
      },
    );

    eq(storedRequires, true);
    eq(deriveRequiresReferral(NutritionStatus.severe, false), true);
  });

  await assert('history newest first', async () => {
    const prisma = {
      child: {
        findFirst: async () => ({
          id: 'child-1',
          centerId: 'center-a',
          status: ChildStatus.active,
          center: { id: 'center-a', districtId: 'd1' },
        }),
      },
      childNutritionScreening: {
        findMany: async ({
          orderBy,
        }: {
          orderBy: Array<{ screeningDate: string }>;
        }) => {
          eq(orderBy[0].screeningDate, 'desc');
          return [
            {
              id: 's2',
              childId: 'child-1',
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
              syncStatus: 'synced',
              lastModifiedByDeviceId: null,
              lastModifiedAt: new Date(),
            },
            {
              id: 's1',
              childId: 'child-1',
              screeningDate: new Date('2026-08-01'),
              weightKg: new Prisma.Decimal('10'),
              muacCm: new Prisma.Decimal('13'),
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
              syncStatus: 'synced',
              lastModifiedByDeviceId: null,
              lastModifiedAt: new Date(),
            },
          ];
        },
      },
    };

    const history = await createService(prisma).getHistory(
      user({ role: UserRole.caregiver, centerId: 'center-a', districtId: 'd1' }),
      'child-1',
    );
    eq(history.items[0].id, 's2');
    eq(history.total, 2);
  });

  await assert('growth chart chronological', async () => {
    const prisma = {
      child: {
        findFirst: async () => ({
          id: 'child-1',
          centerId: 'center-a',
          status: ChildStatus.active,
          center: { id: 'center-a', districtId: 'd1' },
        }),
      },
      childNutritionScreening: {
        findMany: async () => [
          {
            id: 's1',
            childId: 'child-1',
            screeningDate: new Date('2026-08-01'),
            weightKg: new Prisma.Decimal('10'),
            muacCm: new Prisma.Decimal('13'),
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
            syncStatus: 'synced',
            lastModifiedByDeviceId: null,
            lastModifiedAt: new Date(),
          },
          {
            id: 's2',
            childId: 'child-1',
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
            syncStatus: 'synced',
            lastModifiedByDeviceId: null,
            lastModifiedAt: new Date(),
          },
        ],
      },
    };

    const chart = await createService(prisma).getGrowthChart(
      user({ role: UserRole.caregiver, centerId: 'center-a', districtId: 'd1' }),
      'child-1',
    );
    eq(chart.weight[0].value, 10);
    eq(chart.weight[1].value, 11);
    eq(chart.muac.length, 2);
  });

  await assert('authorization: caregiver denied other center', async () => {
    const prisma = {
      child: {
        findFirst: async () => ({
          id: 'child-1',
          centerId: 'center-b',
          status: ChildStatus.active,
          center: { id: 'center-b', districtId: 'd1' },
        }),
      },
    };

    let denied = false;
    try {
      await createService(prisma).createScreening(
        user({
          role: UserRole.caregiver,
          centerId: 'center-a',
          districtId: 'd1',
        }),
        'child-1',
        {
          screeningDate: '2026-08-01',
          weightKg: 10,
          muacCm: 13,
          nutritionStatus: NutritionStatus.normal,
        },
      );
    } catch (err) {
      denied = err instanceof ForbiddenException;
    }
    eq(denied, true);
  });

  await assert('alerts include severe and overdue', async () => {
    const prisma = {
      ecdCenter: { findFirst: async () => null },
      childNutritionScreening: {
        findMany: async () => [
          {
            id: 's1',
            childId: 'child-1',
            screeningDate: new Date('2026-08-01'),
            nutritionStatus: NutritionStatus.severe,
            requiresReferral: true,
            child: {
              id: 'child-1',
              firstName: 'Jean',
              middleName: null,
              lastName: 'Habimana',
              centerId: 'center-a',
              center: { id: 'center-a', name: 'Center A' },
            },
          },
        ],
      },
      child: {
        findMany: async () => [
          {
            id: 'child-2',
            firstName: 'Aline',
            middleName: null,
            lastName: null,
            centerId: 'center-a',
            center: { id: 'center-a', name: 'Center A' },
            nutritionScreenings: [],
          },
        ],
      },
    };

    const alerts = await createService(prisma).getAlerts(
      user({ role: UserRole.ncda_admin }),
      {},
    );

    eq(
      alerts.items.some((a) => a.type === 'severe_nutrition'),
      true,
    );
    eq(
      alerts.items.some((a) => a.type === 'requires_referral'),
      true,
    );
    eq(
      alerts.items.some((a) => a.type === 'overdue_screening'),
      true,
    );
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run();

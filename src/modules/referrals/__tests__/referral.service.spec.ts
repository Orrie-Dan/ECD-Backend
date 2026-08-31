import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ReferralSourceType, ReferralStatus, UserRole } from '@prisma/client';
import { canAccessCenter } from '../../../common/auth/scope.util';
import { createMockLookupResolver } from '../../../common/lookups/lookup-resolver.mock';
import { AuthUser } from '../../auth/interfaces/jwt-payload.interface';
import { CreateReferralDto } from '../dto/create-referral.dto';
import { ReferralsService } from '../referrals.service';

/**
 * Referral service tests (mocked Prisma).
 * Run: npx ts-node src/modules/referrals/__tests__/referral.service.spec.ts
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

function baseDto(overrides: Partial<CreateReferralDto> = {}): CreateReferralDto {
  return {
    childId: 'child-1',
    centerId: 'center-a',
    sourceType: 'nutrition',
    sourceId: 'screen-1',
    referralDate: '2026-08-01',
    reason: 'Severe MUAC',
    destination: 'Health post',
    ...overrides,
  };
}

function referralRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = new Date();
  return {
    id: 'ref-1',
    childId: 'child-1',
    centerId: 'center-a',
    sourceType: ReferralSourceType.nutrition,
    sourceTypeId: null,
    sourceId: 'screen-1',
    referralDate: new Date('2026-08-01T00:00:00.000Z'),
    reason: 'Severe MUAC',
    destination: 'Health post',
    status: ReferralStatus.pending,
    statusId: null,
    implementedAt: null,
    notes: null,
    recordedById: 'cg-1',
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    version: 1,
    syncStatus: 'synced',
    lastModifiedByDeviceId: null,
    lastModifiedAt: now,
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

  const mockNotifications = {
    findUserIdsByRoleAndCenter: async () => [],
    findUserIdsByRoleAndDistrict: async () => [],
    notifyAsync: () => {},
    create: async () => ({}),
    createForMultipleUsers: async () => 0,
  } as any;

  const caregiver = user({
    role: UserRole.caregiver,
    id: 'cg-1',
    centerId: 'center-a',
    districtId: 'd1',
  });
  const focal = user({
    role: UserRole.district_focal_person,
    id: 'focal-1',
    districtId: 'd1',
  });
  const ncda = user({ role: UserRole.ncda_admin, id: 'ncda-1' });

  const syncAccess = {
    resolveScope: async (u: AuthUser) => {
      if (u.role === UserRole.ncda_admin) {
        return { centerIds: 'all' as const, districtId: null };
      }
      if (u.role === UserRole.district_focal_person) {
        return { centerIds: ['center-a', 'center-b'], districtId: 'd1' };
      }
      return { centerIds: [u.centerId!], districtId: u.districtId };
    },
    centerFilter: (scope: { centerIds: string[] | 'all' }) =>
      scope.centerIds === 'all' ? {} : { centerId: { in: scope.centerIds } },
  };

  await assert('Create referral', async () => {
    const creates: Record<string, unknown>[] = [];
    const referralApi = {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        creates.push(data);
        return referralRow(data);
      },
    };
    const prisma = {
      child: {
        findFirst: async () => ({
          id: 'child-1',
          centerId: 'center-a',
          status: 'active',
          center: { id: 'center-a', districtId: 'd1' },
        }),
      },
      childNutritionScreening: {
        findFirst: async () => ({ id: 'screen-1', childId: 'child-1' }),
      },
      referral: referralApi,
      device: { findUnique: async () => null },
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({ referral: referralApi }),
    };

    const result = await new ReferralsService(
      prisma as never,
      syncAccess as never,
      { log: async () => {} } as never,
      mockNotifications,
      createMockLookupResolver(),
    ).create(caregiver, baseDto());

    eq(creates.length, 1);
    eq(creates[0].sourceType, ReferralSourceType.nutrition);
    eq(creates[0].status, ReferralStatus.pending);
    eq(creates[0].recordedById, 'cg-1');
    eq(result.status, 'pending');
    eq(result.sourceType, 'nutrition');
  });

  await assert('Invalid source rejected', async () => {
    const prisma = {
      child: {
        findFirst: async () => ({
          id: 'child-1',
          centerId: 'center-a',
          status: 'active',
          center: { id: 'center-a', districtId: 'd1' },
        }),
      },
      childNutritionScreening: {
        findFirst: async () => null,
      },
      stedAssessment: {
        findFirst: async () => null,
      },
    };

    let caught: unknown;
    try {
      await new ReferralsService(
        prisma as never,
        syncAccess as never,
        { log: async () => {} } as never,
        mockNotifications,
        createMockLookupResolver(),
      ).create(caregiver, baseDto({ sourceId: 'missing' }));
    } catch (err) {
      caught = err;
    }
    eq(caught instanceof BadRequestException, true);
  });

  await assert('Child referral history newest first', async () => {
    const prisma = {
      child: {
        findFirst: async () => ({
          id: 'child-1',
          centerId: 'center-a',
          status: 'active',
          center: { id: 'center-a', districtId: 'd1' },
        }),
      },
      referral: {
        findMany: async ({ orderBy }: { orderBy: Array<Record<string, string>> }) => {
          eq(orderBy[0].referralDate, 'desc');
          return [
            referralRow({ id: 'ref-2', referralDate: new Date('2026-08-10') }),
            referralRow({ id: 'ref-1', referralDate: new Date('2026-07-01') }),
          ];
        },
      },
    };

    const history = await new ReferralsService(
      prisma as never,
      syncAccess as never,
      { log: async () => {} } as never,
      mockNotifications,
      createMockLookupResolver(),
    ).getChildHistory(caregiver, 'child-1');

    eq(history.items[0].id, 'ref-2');
    eq(history.items[1].id, 'ref-1');
    eq(history.total, 2);
  });

  await assert('Status pending → completed', async () => {
    const prisma = {
      referral: {
        findFirst: async () => ({
          ...referralRow(),
          center: { id: 'center-a', districtId: 'd1' },
        }),
        updateMany: async ({ where }: { where: { version: number; status: string } }) => {
          eq(where.version, 1);
          eq(where.status, ReferralStatus.pending);
          return { count: 1 };
        },
        findFirstOrThrow: async () =>
          referralRow({
            status: ReferralStatus.completed,
            implementedAt: new Date(),
            version: 2,
          }),
        findUnique: async () => ({ version: 2 }),
      },
      device: { findUnique: async () => null },
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          referral: {
            updateMany: async ({ where }: { where: { version: number; status: string } }) => {
              eq(where.version, 1);
              eq(where.status, ReferralStatus.pending);
              return { count: 1 };
            },
            findFirstOrThrow: async () =>
              referralRow({
                status: ReferralStatus.completed,
                implementedAt: new Date(),
                version: 2,
              }),
            findUnique: async () => ({ version: 2 }),
          },
        };
        return fn(tx);
      },
    };

    const result = await new ReferralsService(
      prisma as never,
      syncAccess as never,
      { log: async () => {} } as never,
      mockNotifications,
      createMockLookupResolver(),
    ).updateStatus(caregiver, 'ref-1', { status: 'completed', version: 1 });

    eq(result.status, 'completed');
  });

  await assert('Status pending → cancelled', async () => {
    const prisma = {
      referral: {
        findFirst: async () => ({
          ...referralRow(),
          center: { id: 'center-a', districtId: 'd1' },
        }),
      },
      device: { findUnique: async () => null },
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          referral: {
            updateMany: async () => ({ count: 1 }),
            findFirstOrThrow: async () =>
              referralRow({ status: ReferralStatus.cancelled, version: 2 }),
            findUnique: async () => ({ version: 2 }),
          },
        }),
    };

    const result = await new ReferralsService(
      prisma as never,
      syncAccess as never,
      { log: async () => {} } as never,
      mockNotifications,
      createMockLookupResolver(),
    ).updateStatus(caregiver, 'ref-1', { status: 'cancelled', version: 1 });

    eq(result.status, 'cancelled');
  });

  await assert('Stale status update conflicts', async () => {
    const { OptimisticLockConflictException } =
      await import('../../../common/concurrency/optimistic-lock.exception');
    const prisma = {
      referral: {
        findFirst: async () => ({
          ...referralRow({ version: 6 }),
          center: { id: 'center-a', districtId: 'd1' },
        }),
      },
      device: { findUnique: async () => null },
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          referral: {
            updateMany: async () => ({ count: 0 }),
            findUnique: async () => ({ version: 6 }),
          },
        }),
    };

    let caught: unknown;
    try {
      await new ReferralsService(
        prisma as never,
        syncAccess as never,
        { log: async () => {} } as never,
        mockNotifications,
        createMockLookupResolver(),
      ).updateStatus(caregiver, 'ref-1', { status: 'completed', version: 5 });
    } catch (err) {
      caught = err;
    }
    eq(caught instanceof OptimisticLockConflictException, true);
    eq((caught as { currentVersion?: number }).currentVersion, 6);
  });

  await assert('Completed cannot change', async () => {
    const prisma = {
      referral: {
        findFirst: async () => ({
          ...referralRow({ status: ReferralStatus.completed }),
          center: { id: 'center-a', districtId: 'd1' },
        }),
      },
    };

    let caught: unknown;
    try {
      await new ReferralsService(
        prisma as never,
        syncAccess as never,
        { log: async () => {} } as never,
        mockNotifications,
        createMockLookupResolver(),
      ).updateStatus(caregiver, 'ref-1', { status: 'cancelled', version: 1 });
    } catch (err) {
      caught = err;
    }
    eq(caught instanceof BadRequestException, true);
  });

  await assert('Caregiver scope enforcement', async () => {
    eq(canAccessCenter(caregiver, 'center-b', 'd1'), false);
    const prisma = {
      child: {
        findFirst: async () => ({
          id: 'child-x',
          centerId: 'center-b',
          status: 'active',
          center: { id: 'center-b', districtId: 'd1' },
        }),
      },
    };
    let caught: unknown;
    try {
      await new ReferralsService(
        prisma as never,
        syncAccess as never,
        { log: async () => {} } as never,
        mockNotifications,
        createMockLookupResolver(),
      ).create(caregiver, baseDto({ childId: 'child-x', centerId: 'center-b' }));
    } catch (err) {
      caught = err;
    }
    eq(caught instanceof ForbiddenException, true);
  });

  await assert('District scope enforcement', async () => {
    eq(canAccessCenter(focal, 'center-z', 'd2'), false);
    const prisma = {
      child: {
        findFirst: async () => ({
          id: 'child-z',
          centerId: 'center-z',
          status: 'active',
          center: { id: 'center-z', districtId: 'd2' },
        }),
      },
    };
    let caught: unknown;
    try {
      await new ReferralsService(
        prisma as never,
        syncAccess as never,
        { log: async () => {} } as never,
        mockNotifications,
        createMockLookupResolver(),
      ).create(focal, baseDto({ childId: 'child-z', centerId: 'center-z' }));
    } catch (err) {
      caught = err;
    }
    eq(caught instanceof ForbiddenException, true);
  });

  await assert('NCDA unrestricted', async () => {
    eq(canAccessCenter(ncda, 'center-z', 'd9'), true);
    let created = false;
    const referralApi = {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        created = true;
        return referralRow(data);
      },
    };
    const prisma = {
      child: {
        findFirst: async () => ({
          id: 'child-z',
          centerId: 'center-z',
          status: 'active',
          center: { id: 'center-z', districtId: 'd9' },
        }),
      },
      stedAssessment: {
        findFirst: async () => ({ id: 'sted-1', childId: 'child-z' }),
      },
      referral: referralApi,
      device: { findUnique: async () => null },
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({ referral: referralApi }),
    };

    await new ReferralsService(
      prisma as never,
      syncAccess as never,
      { log: async () => {} } as never,
      mockNotifications,
      createMockLookupResolver(),
    ).create(
      ncda,
      baseDto({
        childId: 'child-z',
        centerId: 'center-z',
        sourceType: 'sted',
        sourceId: 'sted-1',
      }),
    );
    eq(created, true);
  });

  await assert('findAll filters referralDate with inclusive from/to', async () => {
    let capturedWhere: Record<string, unknown> | null = null;
    const prisma = {
      referral: {
        findMany: async ({ where }: { where: Record<string, unknown> }) => {
          capturedWhere = where;
          return [referralRow()];
        },
        count: async () => 1,
      },
      $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
    };

    const result = await new ReferralsService(
      prisma as never,
      syncAccess as never,
      { log: async () => {} } as never,
      mockNotifications,
      createMockLookupResolver(),
    ).findAll(focal, {
      from: '2026-08-01',
      to: '2026-08-31',
      page: 1,
      pageSize: 50,
    });

    eq(result.total, 1);
    const dateFilter = capturedWhere
      ? (capturedWhere['referralDate'] as { gte?: Date; lte?: Date })
      : undefined;
    eq(dateFilter?.gte?.toISOString(), '2026-08-01T00:00:00.000Z');
    eq(dateFilter?.lte?.toISOString(), '2026-08-31T00:00:00.000Z');
  });

  await assert('findAll without from/to preserves prior behavior (no date filter)', async () => {
    let capturedWhere: Record<string, unknown> | null = null;
    const prisma = {
      referral: {
        findMany: async ({ where }: { where: Record<string, unknown> }) => {
          capturedWhere = where;
          return [];
        },
        count: async () => 0,
      },
      $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
    };

    await new ReferralsService(
      prisma as never,
      syncAccess as never,
      { log: async () => {} } as never,
      mockNotifications,
      createMockLookupResolver(),
    ).findAll(focal, { page: 1, pageSize: 50 });

    eq(capturedWhere != null && !('referralDate' in capturedWhere), true);
  });

  await assert('findAll rejects invalid from>to', async () => {
    const prisma = {
      referral: {},
      $transaction: async () => [],
    };
    let message = '';
    try {
      await new ReferralsService(
        prisma as never,
        syncAccess as never,
        { log: async () => {} } as never,
        mockNotifications,
        createMockLookupResolver(),
      ).findAll(focal, { from: '2026-08-31', to: '2026-08-01' });
    } catch (err) {
      message = (err as Error).message;
    }
    eq(message.includes('from must be on or before to'), true);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

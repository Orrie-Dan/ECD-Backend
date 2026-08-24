/**
 * WASH module tests.
 * Run: npx ts-node src/modules/wash/__tests__/wash.service.spec.ts
 */
import { ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { OptimisticLockConflictException } from '../../../common/concurrency/optimistic-lock.exception';
import { AuthUser } from '../../auth/interfaces/jwt-payload.interface';
import { WashService } from '../wash.service';

function assert(name: string, fn: () => void | Promise<void>) {
  return (async () => {
    try {
      await fn();
      console.log(`PASS: ${name}`);
    } catch (e) {
      console.error(`FAIL: ${name}`);
      throw e;
    }
  })();
}

function eq(actual: unknown, expected: unknown, label?: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${label ?? 'eq'} expected ${e} got ${a}`);
  }
}

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

function washRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'wash-1',
    centerId: 'center-1',
    recordedDate: new Date('2026-01-15'),
    waterSourceAvailable: true,
    waterSourceType: 'tap',
    sanitationFacilityAvailable: true,
    latrineCount: 3,
    handwashingFacilityAvailable: true,
    wasteManagementAvailable: false,
    notes: null,
    recordedById: 'user-1',
    version: 1,
    createdAt: new Date(),
    deletedAt: null,
    syncStatus: 'synced',
    lastModifiedAt: new Date(),
    lastModifiedByDeviceId: null,
    center: { id: 'center-1', name: 'Center One', districtId: 'district-1' },
    ...overrides,
  };
}

async function main() {
  await assert('list: caregiver sees own center only', async () => {
    const captured: { where?: Record<string, unknown> } = {};
    const prisma = {
      $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
      washIndicator: {
        findMany: async (args: { where: Record<string, unknown> }) => {
          captured.where = args.where;
          return [washRow()];
        },
        count: async () => 1,
      },
    };
    const audit = { log: async () => undefined };
    const service = new WashService(prisma as never, audit as never);

    const result = await service.listIndicators(
      user({ role: UserRole.caregiver, centerId: 'center-1' }),
      {},
    );

    eq(result.total, 1);
    eq(captured.where!.centerId, 'center-1');
  });

  await assert('list: district focal sees own district', async () => {
    const captured: { where?: Record<string, unknown> } = {};
    const prisma = {
      $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
      washIndicator: {
        findMany: async (args: { where: Record<string, unknown> }) => {
          captured.where = args.where;
          return [];
        },
        count: async () => 0,
      },
    };
    const service = new WashService(prisma as never, { log: async () => undefined } as never);

    await service.listIndicators(
      user({ role: UserRole.district_focal_person, districtId: 'district-1' }),
      {},
    );

    eq((captured.where!.center as { districtId: string }).districtId, 'district-1');
  });

  await assert('create: creates indicator with audit', async () => {
    const auditLogs: unknown[] = [];
    const prisma = {
      ecdCenter: {
        findFirst: async () => ({
          id: 'center-1',
          name: 'Center One',
          districtId: 'district-1',
        }),
      },
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          washIndicator: { create: async () => washRow() },
        };
        return fn(tx);
      },
    };
    const audit = {
      log: async (args: unknown) => {
        auditLogs.push(args);
      },
    };
    const service = new WashService(prisma as never, audit as never);

    const result = await service.createIndicator(
      user({ role: UserRole.district_focal_person, districtId: 'district-1' }),
      {
        centerId: 'center-1',
        recordedDate: '2026-01-15',
        waterSourceAvailable: true,
        sanitationFacilityAvailable: true,
        handwashingFacilityAvailable: true,
        wasteManagementAvailable: false,
      },
    );

    eq(result.waterSourceAvailable, true);
    eq(auditLogs.length >= 1, true);
  });

  await assert('update: CAS conflict when version mismatches', async () => {
    const prisma = {
      washIndicator: {
        findFirst: async ({ select }: { select?: { version: boolean } }) => {
          if (select?.version) return { version: 2 };
          return washRow({ version: 2 });
        },
        updateMany: async () => ({ count: 0 }),
      },
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = { washIndicator: prisma.washIndicator };
        return fn(tx);
      },
    };
    const service = new WashService(prisma as never, { log: async () => undefined } as never);

    let threw = false;
    try {
      await service.updateIndicator(user({ role: UserRole.ncda_admin }), 'wash-1', {
        version: 1,
        waterSourceAvailable: false,
      });
    } catch (e) {
      threw = e instanceof OptimisticLockConflictException;
    }
    eq(threw, true);
  });

  await assert('getIndicator: forbidden outside center scope', async () => {
    const prisma = {
      washIndicator: {
        findFirst: async () =>
          washRow({
            center: { id: 'center-x', name: 'Other', districtId: 'other-district' },
          }),
      },
    };
    const service = new WashService(prisma as never, { log: async () => undefined } as never);

    let threw = false;
    try {
      await service.getIndicator(
        user({ role: UserRole.district_focal_person, districtId: 'district-1' }),
        'wash-1',
      );
    } catch (e) {
      threw = e instanceof ForbiddenException;
    }
    eq(threw, true);
  });

  console.log('\nAll wash tests passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

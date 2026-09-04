/**
 * Centers module tests.
 * Run: npx ts-node src/modules/centers/__tests__/centers.service.spec.ts
 */
import { EcdCenterStatus, UserRole } from '../../../common/domain';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { assertCasApplied } from '../../../common/concurrency/cas.util';
import { OptimisticLockConflictException } from '../../../common/concurrency/optimistic-lock.exception';
import { AuthUser } from '../../auth/interfaces/jwt-payload.interface';
import { CentersService } from '../centers.service';
import { centerMapper } from '../mappers/center.mapper';

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

function centerRow(overrides: Record<string, unknown> = {}) {
  const now = new Date();
  return {
    id: 'center-1',
    districtId: 'district-1',
    villageId: 'village-1',
    code: 'C001',
    name: 'Center One',
    phone: '0780000000',
    capacity: 40,
    latitude: null,
    longitude: null,
    status: EcdCenterStatus.active,
    currentComplianceLevel: null,
    currentComplianceAssessedAt: null,
    createdAt: now,
    createdById: null,
    updatedAt: now,
    updatedById: null,
    deletedAt: null,
    version: 3,
    syncStatus: 'synced',
    lastModifiedByDeviceId: null,
    lastModifiedAt: now,
    district: { id: 'district-1', name: 'Gasabo' },
    village: { id: 'village-1', name: 'Village' },
    _count: { children: 12 },
    ...overrides,
  };
}

async function main() {
  await assert('mapper: list dto maps active children count', () => {
    const dto = centerMapper.toListDto(centerRow() as never);
    eq(dto.code, 'C001');
    eq(dto.activeChildrenCount, 12);
    eq(dto.districtName, 'Gasabo');
    eq(dto.version, 3);
  });

  await assert('list: district focal scoped to own district', async () => {
    const captured: { where?: unknown } = {};
    const prisma = {
      $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
      ecdCenter: {
        findMany: async (args: { where: unknown }) => {
          captured.where = args.where;
          return [centerRow()];
        },
        count: async () => 1,
      },
    };
    const audit = { log: async () => undefined };
    const service = new CentersService(prisma as never, audit as never);

    const result = await service.findAll(
      user({
        role: UserRole.district_focal_person,
        districtId: 'district-1',
      }),
      { page: 1, pageSize: 20 },
    );

    eq(result.total, 1);
    eq(result.items[0].id, 'center-1');
    eq((captured.where as { districtId: string }).districtId, 'district-1', 'district scope');
  });

  await assert('list: caregiver only sees own center', async () => {
    const captured: { where?: unknown } = {};
    const prisma = {
      $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
      ecdCenter: {
        findMany: async (args: { where: unknown }) => {
          captured.where = args.where;
          return [centerRow({ id: 'center-a' })];
        },
        count: async () => 1,
      },
    };
    const service = new CentersService(prisma as never, { log: async () => undefined } as never);

    await service.findAll(user({ role: UserRole.caregiver, centerId: 'center-a' }), {});
    eq((captured.where as { id: string }).id, 'center-a');
  });

  await assert('list: search + status filters applied', async () => {
    const captured: { where?: Record<string, unknown> } = {};
    const prisma = {
      $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
      ecdCenter: {
        findMany: async (args: { where: Record<string, unknown> }) => {
          captured.where = args.where;
          return [];
        },
        count: async () => 0,
      },
    };
    const service = new CentersService(prisma as never, { log: async () => undefined } as never);

    await service.findAll(user({ role: UserRole.ncda_admin }), {
      search: 'gasabo',
      status: EcdCenterStatus.inactive,
      districtId: 'district-9',
    });

    eq(captured.where!.districtId, 'district-9');
    eq(captured.where!.status, EcdCenterStatus.inactive);
    eq(Array.isArray(captured.where!.OR), true);
  });

  await assert('detail: forbidden outside district', async () => {
    const prisma = {
      ecdCenter: {
        findFirst: async () =>
          centerRow({
            id: 'center-x',
            districtId: 'other-district',
            district: {
              id: 'other-district',
              name: 'Other',
              province: { name: 'P' },
            },
            _count: { children: 0, userAccounts: 0 },
          }),
      },
    };
    const service = new CentersService(prisma as never, { log: async () => undefined } as never);

    let threw = false;
    try {
      await service.findOne(
        user({
          role: UserRole.district_focal_person,
          districtId: 'district-1',
        }),
        'center-x',
      );
    } catch (e) {
      threw = e instanceof ForbiddenException;
    }
    eq(threw, true);
  });

  await assert('update: CAS conflict when version mismatches', async () => {
    let updateCount = 0;
    const prisma = {
      ecdCenter: {
        findFirst: async ({
          select,
        }: {
          where: { id: string; deletedAt: null; version?: number };
          select?: { version: true };
        }) => {
          if (select?.version) {
            return { version: 4 };
          }
          return centerRow({ version: 4 });
        },
        findUniqueOrThrow: async () => centerRow({ version: 4 }),
        updateMany: async () => {
          updateCount += 1;
          return { count: 0 };
        },
      },
      administrativeUnit: { findFirst: async () => ({ id: 'village-1' }) },
      device: { findFirst: async () => null },
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          ecdCenter: prisma.ecdCenter,
        };
        return fn(tx);
      },
    };

    // Patch assertCasApplied path via real service
    const auditLogs: unknown[] = [];
    const service = new CentersService(
      prisma as never,
      {
        log: async (args: unknown) => {
          auditLogs.push(args);
        },
      } as never,
    );

    let err: unknown;
    try {
      await service.update(
        user({
          role: UserRole.district_focal_person,
          districtId: 'district-1',
        }),
        'center-1',
        { version: 3, name: 'Renamed' },
      );
    } catch (e) {
      err = e;
    }

    eq(updateCount >= 1, true);
    eq(err instanceof OptimisticLockConflictException, true);
    eq(auditLogs.length, 0, 'no audit on CAS miss');
  });

  await assert('update: not found', async () => {
    const prisma = {
      ecdCenter: { findFirst: async () => null },
    };
    const service = new CentersService(prisma as never, { log: async () => undefined } as never);
    let threw = false;
    try {
      await service.update(user({ role: UserRole.ncda_admin }), 'missing', {
        version: 1,
        name: 'X',
      });
    } catch (e) {
      threw = e instanceof NotFoundException;
    }
    eq(threw, true);
  });

  await assert('cas util still distinguishes conflict', async () => {
    await assertCasApplied(0, 'ecd_center', async () => ({ version: 9 })).then(
      () => {
        throw new Error('expected throw');
      },
      (e) => {
        if (!(e instanceof OptimisticLockConflictException)) throw e;
        eq(e.currentVersion, 9);
      },
    );
  });

  console.log('\nAll centers tests passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

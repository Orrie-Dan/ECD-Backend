/**
 * Children list districtId filter tests.
 * Run: npx ts-node src/modules/children/__tests__/children.list-district.spec.ts
 */
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { AuthUser } from '../../auth/interfaces/jwt-payload.interface';
import { ChildrenService } from '../children.service';

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

async function main() {
  await assert('findAll: ncda districtId scopes via center.districtId', async () => {
    let capturedWhere: unknown;
    const prisma = {
      ecdCenter: { findFirst: async () => null },
      $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
      child: {
        findMany: async (args: { where: unknown }) => {
          capturedWhere = args.where;
          return [];
        },
        count: async () => 0,
      },
    };
    const syncAccess = {
      resolveScope: async () => ({ centerIds: 'all' as const, districtId: null }),
      centerFilter: () => ({}),
    };
    const service = new ChildrenService(
      prisma as never,
      syncAccess as never,
      { log: async () => undefined } as never,
    );

    await service.findAll(user({ role: UserRole.ncda_admin }), {
      districtId: 'district-1',
      page: 1,
      pageSize: 10,
    });

    eq(
      (capturedWhere as { center?: { districtId?: string } }).center?.districtId,
      'district-1',
      'district filter',
    );
  });

  await assert('findAll: dfp cannot query foreign districtId', async () => {
    const prisma = {
      ecdCenter: { findFirst: async () => null },
      $transaction: async () => [[], 0],
      child: { findMany: async () => [], count: async () => 0 },
    };
    const syncAccess = {
      resolveScope: async () => ({
        centerIds: ['center-a'],
        districtId: 'district-1',
      }),
      centerFilter: () => ({ centerId: { in: ['center-a'] } }),
    };
    const service = new ChildrenService(
      prisma as never,
      syncAccess as never,
      { log: async () => undefined } as never,
    );

    let threw = false;
    try {
      await service.findAll(
        user({
          role: UserRole.district_focal_person,
          districtId: 'district-1',
        }),
        { districtId: 'other-district' },
      );
    } catch (e) {
      threw = e instanceof ForbiddenException;
    }
    eq(threw, true, 'forbidden');
  });

  await assert('findAll: mismatched centerId+districtId is bad request', async () => {
    const prisma = {
      ecdCenter: {
        findFirst: async () => ({ id: 'center-a', districtId: 'district-1' }),
      },
      $transaction: async () => [[], 0],
      child: { findMany: async () => [], count: async () => 0 },
    };
    const syncAccess = {
      resolveScope: async () => ({ centerIds: 'all' as const, districtId: null }),
      centerFilter: () => ({}),
    };
    const service = new ChildrenService(
      prisma as never,
      syncAccess as never,
      { log: async () => undefined } as never,
    );

    let threw = false;
    try {
      await service.findAll(user({ role: UserRole.ncda_admin }), {
        centerId: 'center-a',
        districtId: 'district-2',
      });
    } catch (e) {
      threw = e instanceof BadRequestException;
    }
    eq(threw, true, 'bad request');
  });

  console.log('All children.list-district tests passed');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

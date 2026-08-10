/**
 * Geo module tests.
 * Run: npx ts-node src/modules/geo/__tests__/geo.service.spec.ts
 */
import { ForbiddenException } from '@nestjs/common';
import { AdministrativeLevel, UserRole } from '@prisma/client';
import { AuthUser } from '../../auth/interfaces/jwt-payload.interface';
import { GeoService } from '../geo.service';

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
  await assert('listAdminUnits: ncda can list all', async () => {
    const prisma = {
      administrativeUnit: {
        findMany: async () => [
          {
            id: 'unit-1',
            level: AdministrativeLevel.village,
            parentId: null,
            districtId: 'district-1',
            name: 'Village A',
            code: 'VA',
            latitude: null,
            longitude: null,
            createdAt: new Date(),
          },
        ],
      },
    };
    const service = new GeoService(prisma as never);

    const result = await service.listAdminUnits(
      user({ role: UserRole.ncda_admin }),
      { level: AdministrativeLevel.village },
    );

    eq(result.length, 1);
    eq(result[0].name, 'Village A');
  });

  await assert('listAdminUnits: district focal denied other district', async () => {
    const prisma = {
      administrativeUnit: { findMany: async () => [] },
    };
    const service = new GeoService(prisma as never);

    let threw = false;
    try {
      await service.listAdminUnits(
        user({ role: UserRole.district_focal_person, districtId: 'district-1' }),
        { districtId: 'other-district' },
      );
    } catch (e) {
      threw = e instanceof ForbiddenException;
    }
    eq(threw, true);
  });

  await assert('listDistricts: district focal sees own district only', async () => {
    const captured: { where?: Record<string, unknown> } = {};
    const prisma = {
      $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
      district: {
        findMany: async (args: { where: Record<string, unknown> }) => {
          captured.where = args.where;
          return [
            {
              id: 'district-1',
              provinceId: 'province-1',
              code: 'D1',
              name: 'District One',
              isActive: true,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          ];
        },
        count: async () => 1,
      },
    };
    const service = new GeoService(prisma as never);

    const result = await service.listDistricts(
      user({ role: UserRole.district_focal_person, districtId: 'district-1' }),
      {},
    );

    eq(result.total, 1);
    eq(captured.where!.id, 'district-1');
  });

  await assert('listCentersByDistrict: caregiver denied', async () => {
    const prisma = {
      district: { findUnique: async () => ({ id: 'district-1' }) },
    };
    const service = new GeoService(prisma as never);

    let threw = false;
    try {
      await service.listCentersByDistrict(
        user({ role: UserRole.caregiver, centerId: 'center-1', districtId: 'district-1' }),
        'district-1',
        {},
      );
    } catch (e) {
      threw = e instanceof ForbiddenException;
    }
    eq(threw, true);
  });

  await assert('listCentersByDistrict: district focal can list own district', async () => {
    const prisma = {
      district: { findUnique: async () => ({ id: 'district-1' }) },
      $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
      ecdCenter: {
        findMany: async () => [
          {
            id: 'center-1',
            code: 'C1',
            name: 'Center One',
            phone: null,
            capacity: 50,
            status: 'active',
            villageId: 'village-1',
            latitude: null,
            longitude: null,
            village: { id: 'village-1', name: 'Village A' },
          },
        ],
        count: async () => 1,
      },
    };
    const service = new GeoService(prisma as never);

    const result = await service.listCentersByDistrict(
      user({ role: UserRole.district_focal_person, districtId: 'district-1' }),
      'district-1',
      {},
    );

    eq(result.total, 1);
    eq(result.items[0].name, 'Center One');
  });

  console.log('\nAll geo tests passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

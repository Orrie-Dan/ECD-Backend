import { AdministrativeLevel, UserRole } from '../../../common/domain';
import { BadRequestException } from '@nestjs/common';
import {
  childCenterWhere,
  ecdCenterWhere,
  resolveDistrictQueryScope,
} from '../../../common/scope/district-query.scope';
import { AuthUser } from '../../../modules/auth/interfaces/jwt-payload.interface';

/**
 * FIX-02 — full geographic hierarchy resolution tests (mocked Prisma).
 * Run: npm run test:sector-scope  (includes this file via ts-node if wired)
 * or: npx ts-node src/common/scope/__tests__/geographic-query-scope.spec.ts
 */

function auth(partial: Partial<AuthUser> & Pick<AuthUser, 'role'>): AuthUser {
  return {
    id: partial.id ?? 'u1',
    username: partial.username ?? 'user',
    email: null,
    fullName: 'User',
    role: partial.role,
    districtId: partial.districtId ?? null,
    sectorId: partial.sectorId ?? null,
    centerId: partial.centerId ?? null,
    status: 'active',
  };
}

function eq(actual: unknown, expected: unknown, msg?: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${msg ?? 'assert'}: expected ${e}, got ${a}`);
  }
}

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

type Unit = {
  id: string;
  level: string;
  parentId: string | null;
  districtId: string | null;
};

function mockPrisma(opts: {
  districts?: Array<{ id: string; provinceId: string }>;
  units?: Unit[];
  centers?: Array<{ id: string; districtId: string; villageId: string }>;
}) {
  const districts = opts.districts ?? [];
  const units = opts.units ?? [];
  const centers = opts.centers ?? [];

  return {
    district: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        districts.find((d) => d.id === where.id) ?? null,
      findFirst: async ({ where }: { where: { id: string } }) =>
        districts.find((d) => d.id === where.id) ?? null,
    },
    administrativeUnit: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        const u = units.find((x) => x.id === where.id);
        return u
          ? {
              id: u.id,
              level: u.level,
              parentId: u.parentId,
              districtId: u.districtId,
            }
          : null;
      },
      findMany: async ({
        where,
      }: {
        where: { parentId?: { in: string[] } };
      }) => {
        if (where.parentId?.in) {
          return units
            .filter((u) => u.parentId && where.parentId!.in.includes(u.parentId))
            .map((u) => ({ id: u.id, level: u.level }));
        }
        return [];
      },
    },
    ecdCenter: {
      findFirst: async ({
        where,
      }: {
        where: { id: string; deletedAt: null };
      }) => centers.find((c) => c.id === where.id) ?? null,
      findMany: async ({
        where,
      }: {
        where: {
          districtId?: string;
          deletedAt: null;
          villageId?: string | { in: string[] };
          district?: { provinceId: string };
        };
      }) => {
        let rows = [...centers];
        if (where.districtId) {
          rows = rows.filter((c) => c.districtId === where.districtId);
        }
        if (where.district?.provinceId) {
          const allowed = new Set(
            districts
              .filter((d) => d.provinceId === where.district!.provinceId)
              .map((d) => d.id),
          );
          rows = rows.filter((c) => allowed.has(c.districtId));
        }
        if (typeof where.villageId === 'string') {
          rows = rows.filter((c) => c.villageId === where.villageId);
        } else if (where.villageId && typeof where.villageId === 'object' && 'in' in where.villageId) {
          const ids = where.villageId.in;
          rows = rows.filter((c) => ids.includes(c.villageId));
        }
        return rows.map((c) => ({ id: c.id }));
      },
    },
  };
}

/** Fixture hierarchy */
const P_A = 'prov-a';
const P_B = 'prov-b';
const D_A = 'dist-a';
const D_B = 'dist-b';
const S_A1 = 'sector-a1';
const S_B1 = 'sector-b1';
const CELL_A1 = 'cell-a1';
const CELL_B1 = 'cell-b1';
const V_A1 = 'village-a1';
const V_A2 = 'village-a2';
const V_B1 = 'village-b1';
const C_A1 = 'center-a1';
const C_A2 = 'center-a2';
const C_B1 = 'center-b1';

const units: Unit[] = [
  { id: S_A1, level: AdministrativeLevel.sector, parentId: null, districtId: D_A },
  { id: CELL_A1, level: AdministrativeLevel.cell, parentId: S_A1, districtId: D_A },
  { id: V_A1, level: AdministrativeLevel.village, parentId: CELL_A1, districtId: D_A },
  { id: V_A2, level: AdministrativeLevel.village, parentId: CELL_A1, districtId: D_A },
  { id: S_B1, level: AdministrativeLevel.sector, parentId: null, districtId: D_B },
  { id: CELL_B1, level: AdministrativeLevel.cell, parentId: S_B1, districtId: D_B },
  { id: V_B1, level: AdministrativeLevel.village, parentId: CELL_B1, districtId: D_B },
];

const districts = [
  { id: D_A, provinceId: P_A },
  { id: D_B, provinceId: P_B },
];

const centers = [
  { id: C_A1, districtId: D_A, villageId: V_A1 },
  { id: C_A2, districtId: D_A, villageId: V_A2 },
  { id: C_B1, districtId: D_B, villageId: V_B1 },
];

async function run() {
  const prisma = mockPrisma({ districts, units, centers }) as never;
  const ncda = auth({ role: UserRole.ncda_admin });

  // National
  {
    const scope = await resolveDistrictQueryScope(prisma, ncda, {});
    eq(scope.centerIds, 'all');
    eq(ecdCenterWhere(scope), { deletedAt: null });
  }

  // Province → relational (no huge IN)
  {
    const scope = await resolveDistrictQueryScope(prisma, ncda, { provinceId: P_A });
    eq(scope.centerIds, 'all');
    eq(scope.provinceId, P_A);
    eq(ecdCenterWhere(scope), {
      district: { provinceId: P_A },
      deletedAt: null,
    });
    eq(childCenterWhere(scope), {
      center: { district: { provinceId: P_A }, deletedAt: null },
    });
  }

  // District → relational
  {
    const scope = await resolveDistrictQueryScope(prisma, ncda, { districtId: D_A });
    eq(scope.centerIds, 'all');
    eq(scope.districtId, D_A);
    eq(ecdCenterWhere(scope).districtId, D_A);
  }

  // Sector → materialize centers under villages
  {
    const scope = await resolveDistrictQueryScope(prisma, ncda, {
      districtId: D_A,
      sectorId: S_A1,
    });
    assert(Array.isArray(scope.centerIds), 'sector should materialize ids');
    eq([...(scope.centerIds as string[])].sort(), [C_A1, C_A2].sort());
  }

  // Cell
  {
    const scope = await resolveDistrictQueryScope(prisma, ncda, {
      districtId: D_A,
      sectorId: S_A1,
      cellId: CELL_A1,
    });
    eq([...(scope.centerIds as string[])].sort(), [C_A1, C_A2].sort());
  }

  // Village
  {
    const scope = await resolveDistrictQueryScope(prisma, ncda, {
      districtId: D_A,
      villageId: V_A1,
    });
    eq(scope.centerIds, [C_A1]);
  }

  // Center
  {
    const scope = await resolveDistrictQueryScope(prisma, ncda, { centerId: C_A1 });
    eq(scope.centerIds, [C_A1]);
    eq(scope.singleCenterId, C_A1);
  }

  // Invalid: Province A + District B → 400
  {
    let threw = false;
    try {
      await resolveDistrictQueryScope(prisma, ncda, {
        provinceId: P_A,
        districtId: D_B,
      });
    } catch (e) {
      threw = e instanceof BadRequestException;
    }
    assert(threw, 'expected BadRequest for province/district mismatch');
  }

  // Invalid: District A + Sector from District B → 400
  {
    let threw = false;
    try {
      await resolveDistrictQueryScope(prisma, ncda, {
        districtId: D_A,
        sectorId: S_B1,
      });
    } catch (e) {
      threw = e instanceof BadRequestException;
    }
    assert(threw, 'expected BadRequest for district/sector mismatch');
  }

  // Invalid: Sector A + Cell from Sector B → 400
  {
    let threw = false;
    try {
      await resolveDistrictQueryScope(prisma, ncda, {
        districtId: D_A,
        sectorId: S_A1,
        cellId: CELL_B1,
      });
    } catch (e) {
      threw = e instanceof BadRequestException;
    }
    assert(threw, 'expected BadRequest for sector/cell mismatch');
  }

  // Invalid: Cell A + Village from Cell B → 400
  {
    let threw = false;
    try {
      await resolveDistrictQueryScope(prisma, ncda, {
        districtId: D_A,
        cellId: CELL_A1,
        villageId: V_B1,
      });
    } catch (e) {
      threw = e instanceof BadRequestException;
    }
    assert(threw, 'expected BadRequest for cell/village mismatch');
  }

  // Invalid: Village A + Center from Village B → 400
  {
    let threw = false;
    try {
      await resolveDistrictQueryScope(prisma, ncda, {
        villageId: V_A1,
        centerId: C_B1,
      });
    } catch (e) {
      threw = e instanceof BadRequestException;
    }
    assert(threw, 'expected BadRequest for village/center mismatch');
  }

  // District officer cannot query another district
  {
    const officer = auth({
      role: UserRole.district_focal_person,
      districtId: D_A,
    });
    let threw = false;
    try {
      await resolveDistrictQueryScope(prisma, officer, { districtId: D_B });
    } catch {
      threw = true;
    }
    assert(threw, 'district officer must not broaden to District B');
  }

  console.log('geographic-query-scope.spec.ts: OK');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

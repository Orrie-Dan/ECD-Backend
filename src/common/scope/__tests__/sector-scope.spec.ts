import { AdministrativeLevel, UserRole } from '../../../common/domain';
import { ForbiddenException } from '@nestjs/common';
import {
  applyAuthenticatedGeographicQuery,
  assertCenterAccessible,
  collectVillageIdsUnder,
  resolveDistrictQueryScope,
} from '../../../common/scope/district-query.scope';
import { isDistrictPortalRole } from '../../../common/auth/scope.util';
import { AuthUser } from '../../../modules/auth/interfaces/jwt-payload.interface';

/**
 * SECTOR-USER-02 — geographic scope + IDOR unit tests (mocked Prisma).
 * Run: npx ts-node src/common/scope/__tests__/sector-scope.spec.ts
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

function mockPrisma(opts: {
  villagesUnderSector?: Record<string, string[]>;
  centers?: Array<{ id: string; districtId: string; villageId: string }>;
  sectors?: Array<{ id: string; districtId: string | null; level: string }>;
  adminUnits?: Array<{
    id: string;
    level: string;
    parentId: string | null;
    districtId: string | null;
  }>;
}) {
  const villagesUnderSector = opts.villagesUnderSector ?? {};
  const centers = opts.centers ?? [];
  const sectors = opts.sectors ?? [];
  const adminUnits = opts.adminUnits ?? [];

  return {
    administrativeUnit: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        const sector = sectors.find((s) => s.id === where.id);
        if (sector) {
          return { id: sector.id, level: sector.level, districtId: sector.districtId };
        }
        const unit = adminUnits.find((u) => u.id === where.id);
        if (unit) {
          return {
            id: unit.id,
            level: unit.level,
            parentId: unit.parentId,
            districtId: unit.districtId,
          };
        }
        return null;
      },
      findMany: async ({
        where,
      }: {
        where: { parentId?: { in: string[] } };
      }) => {
        if (where.parentId?.in) {
          return adminUnits
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
          villageId?: { in: string[] };
        };
      }) => {
        let rows = centers.filter((c) => !where.districtId || c.districtId === where.districtId);
        if (where.villageId?.in) {
          rows = rows.filter((c) => where.villageId!.in.includes(c.villageId));
        }
        return rows.map((c) => ({ id: c.id }));
      },
    },
    // Used by collectVillageIdsUnder BFS — seed children under sector via adminUnits
    _villagesUnderSector: villagesUnderSector,
  } as any;
}

/** Prisma mock that drives collectVillageIdsUnder via admin unit hierarchy. */
function hierarchyPrisma(input: {
  sectorId: string;
  districtId: string;
  cellId: string;
  villageA: string;
  villageB: string;
  centerA: string;
  centerB: string;
}) {
  const adminUnits = [
    {
      id: input.sectorId,
      level: AdministrativeLevel.sector,
      parentId: null as string | null,
      districtId: input.districtId,
    },
    {
      id: input.cellId,
      level: AdministrativeLevel.cell,
      parentId: input.sectorId,
      districtId: null,
    },
    {
      id: input.villageA,
      level: AdministrativeLevel.village,
      parentId: input.cellId,
      districtId: null,
    },
    {
      id: input.villageB,
      level: AdministrativeLevel.village,
      parentId: 'other-cell',
      districtId: null,
    },
    {
      id: 'other-cell',
      level: AdministrativeLevel.cell,
      parentId: 'other-sector',
      districtId: null,
    },
    {
      id: 'other-sector',
      level: AdministrativeLevel.sector,
      parentId: null,
      districtId: input.districtId,
    },
  ];

  const centers = [
    {
      id: input.centerA,
      districtId: input.districtId,
      villageId: input.villageA,
    },
    {
      id: input.centerB,
      districtId: input.districtId,
      villageId: input.villageB,
    },
  ];

  return mockPrisma({
    sectors: [
      { id: input.sectorId, districtId: input.districtId, level: AdministrativeLevel.sector },
      { id: 'other-sector', districtId: input.districtId, level: AdministrativeLevel.sector },
    ],
    adminUnits,
    centers,
  });
}

async function run() {
  let passed = 0;
  let failed = 0;

  const assert = async (name: string, fn: () => Promise<void> | void) => {
    try {
      await fn();
      passed += 1;
      console.log(`  ✓ ${name}`);
    } catch (e) {
      failed += 1;
      console.error(`  ✗ ${name}`);
      console.error(e);
    }
  };

  const eq = (a: unknown, b: unknown) => {
    if (a !== b) throw new Error(`Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
  };

  console.log('\nSECTOR-USER-02 scope tests\n');

  await assert('isDistrictPortalRole includes sector', () => {
    eq(isDistrictPortalRole(UserRole.sector_focal_person), true);
    eq(isDistrictPortalRole(UserRole.district_focal_person), true);
    eq(isDistrictPortalRole(UserRole.ncda_admin), false);
  });

  await assert('applyAuthenticatedGeographicQuery pins sector', () => {
    const user = auth({
      role: UserRole.sector_focal_person,
      districtId: 'd1',
      sectorId: 's-kimihurura',
    });
    const pinned = applyAuthenticatedGeographicQuery(user, {});
    eq(pinned.districtId, 'd1');
    eq(pinned.sectorId, 's-kimihurura');
  });

  await assert('applyAuthenticatedGeographicQuery rejects foreign sector', () => {
    const user = auth({
      role: UserRole.sector_focal_person,
      districtId: 'd1',
      sectorId: 's-kimihurura',
    });
    try {
      applyAuthenticatedGeographicQuery(user, { sectorId: 's-kimironko' });
      throw new Error('expected ForbiddenException');
    } catch (e) {
      if (!(e instanceof ForbiddenException)) throw e;
    }
  });

  await assert('applyAuthenticatedGeographicQuery rejects foreign district', () => {
    const user = auth({
      role: UserRole.sector_focal_person,
      districtId: 'd1',
      sectorId: 's-kimihurura',
    });
    try {
      applyAuthenticatedGeographicQuery(user, { districtId: 'd2' });
      throw new Error('expected ForbiddenException');
    } catch (e) {
      if (!(e instanceof ForbiddenException)) throw e;
    }
  });

  const geo = {
    sectorId: 's-kimihurura',
    districtId: 'd-gasabo',
    cellId: 'cell-1',
    villageA: 'v-kimi',
    villageB: 'v-kimo',
    centerA: 'c-kimi',
    centerB: 'c-kimo',
  };
  const prisma = hierarchyPrisma(geo);

  await assert('collectVillageIdsUnder returns Kimihurura villages', async () => {
    const villages = await collectVillageIdsUnder(prisma, geo.sectorId);
    eq(villages.includes(geo.villageA), true);
    eq(villages.includes(geo.villageB), false);
  });

  await assert('resolveDistrictQueryScope sector → only Kimihurura centers', async () => {
    const user = auth({
      role: UserRole.sector_focal_person,
      districtId: geo.districtId,
      sectorId: geo.sectorId,
    });
    const scope = await resolveDistrictQueryScope(prisma, user, {});
    eq(Array.isArray(scope.centerIds), true);
    const ids = scope.centerIds as string[];
    eq(ids.includes(geo.centerA), true);
    eq(ids.includes(geo.centerB), false);
    eq(scope.sectorId, geo.sectorId);
  });

  await assert('resolveDistrictQueryScope district optional sector drill-down', async () => {
    const user = auth({
      role: UserRole.district_focal_person,
      districtId: geo.districtId,
    });
    const all = await resolveDistrictQueryScope(prisma, user, {});
    // District-only uses relational filter (no huge IN list).
    eq(all.centerIds, 'all');
    eq(all.districtId, geo.districtId);

    const drilled = await resolveDistrictQueryScope(prisma, user, {
      sectorId: geo.sectorId,
    });
    eq((drilled.centerIds as string[]).includes(geo.centerA), true);
    eq((drilled.centerIds as string[]).includes(geo.centerB), false);
  });

  await assert('assertCenterAccessible allows Kimihurura center for Sector', async () => {
    const user = auth({
      role: UserRole.sector_focal_person,
      districtId: geo.districtId,
      sectorId: geo.sectorId,
    });
    await assertCenterAccessible(prisma, user, {
      id: geo.centerA,
      districtId: geo.districtId,
      villageId: geo.villageA,
    });
  });

  await assert('assertCenterAccessible denies Kimironko center for Sector', async () => {
    const user = auth({
      role: UserRole.sector_focal_person,
      districtId: geo.districtId,
      sectorId: geo.sectorId,
    });
    try {
      await assertCenterAccessible(prisma, user, {
        id: geo.centerB,
        districtId: geo.districtId,
        villageId: geo.villageB,
      });
      throw new Error('expected ForbiddenException');
    } catch (e) {
      if (!(e instanceof ForbiddenException)) throw e;
    }
  });

  await assert('Sector query with districtId only still sector-scoped', async () => {
    const user = auth({
      role: UserRole.sector_focal_person,
      districtId: geo.districtId,
      sectorId: geo.sectorId,
    });
    const scope = await resolveDistrictQueryScope(prisma, user, {
      districtId: geo.districtId,
    });
    eq((scope.centerIds as string[]).includes(geo.centerB), false);
    eq(scope.sectorId, geo.sectorId);
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});

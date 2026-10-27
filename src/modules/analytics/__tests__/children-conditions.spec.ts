/**
 * Children-by-condition per area tests.
 * Run: npx ts-node src/modules/analytics/__tests__/children-conditions.spec.ts
 */
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { UserRole } from '../../../common/domain';
import { AuthUser } from '../../auth/interfaces/jwt-payload.interface';
import { whoSdCutoff } from '../../nutrition/who/classify';
import {
  CONDITION_MIN_DENOMINATOR,
  buildConditionAreaItems,
  conditionMeasure,
  tallyConditionsByArea,
  type LatestHeightRow,
  type LatestScreeningRow,
} from '../children-conditions.calc';
import { ChildrenConditionsService } from '../children-conditions.service';

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

async function rejects(fn: () => Promise<unknown>, type: new (...args: never[]) => Error) {
  try {
    await fn();
  } catch (e) {
    if (e instanceof type) return;
    throw new Error(`expected ${type.name}, got ${String(e)}`);
  }
  throw new Error(`expected ${type.name}, resolved instead`);
}

function user(partial: Partial<AuthUser> & Pick<AuthUser, 'role'>): AuthUser {
  return {
    id: 'user-1',
    username: 'u',
    email: null,
    fullName: 'U',
    role: partial.role,
    centerId: partial.centerId ?? null,
    districtId: partial.districtId ?? null,
    sectorId: partial.sectorId ?? null,
    status: 'active',
  };
}

// Boy aged exactly 24 months at screening.
const DOB = '2024-01-01';
const SCREENED = '2026-01-01';
const AGE = 24;
const at = (indicator: Parameters<typeof whoSdCutoff>[0], z: number) =>
  whoSdCutoff(indicator, 'boys', AGE, z) as number;

function screening(
  childId: string,
  areaId: string,
  z: { weight: number; muac: number },
  dateOfBirth: string | null = DOB,
): LatestScreeningRow {
  return {
    areaId,
    childId,
    dateOfBirth,
    gender: 'male',
    screeningDate: SCREENED,
    weightKg: at('weight_for_age', z.weight),
    muacCm: at('muac_for_age', z.muac),
  };
}

function height(childId: string, areaId: string, z: number): LatestHeightRow {
  return {
    areaId,
    childId,
    dateOfBirth: DOB,
    gender: 'male',
    screeningDate: SCREENED,
    heightCm: at('height_for_age', z),
  };
}

const area = (areaId: string, areaName: string) => ({
  areaId,
  areaName,
  areaCode: areaId.toUpperCase(),
  districtId: 'd1',
  districtName: 'Gasabo',
});

/** Fake Prisma: records raw SQL parameter values, returns canned rows per query tag. */
function createPrisma(
  rows: { children?: unknown[]; screenings?: unknown[]; heights?: unknown[] } = {},
) {
  const sqlValues: unknown[][] = [];
  return {
    sqlValues,
    district: {
      findMany: async ({ where }: { where: { id?: string } }) =>
        [
          { id: 'd1', name: 'Gasabo', code: 'GAS' },
          { id: 'd2', name: 'Bugesera', code: 'BUG' },
        ].filter((d) => !where.id || d.id === where.id),
      findUnique: async ({ where }: { where: { id: string } }) =>
        where.id === 'd1' ? { id: 'd1', name: 'Gasabo' } : null,
    },
    administrativeUnit: {
      findMany: async () => [{ id: 's1', name: 'Kimironko', code: '110203' }],
    },
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = JSON.stringify([strings, values]);
      // Flatten nested Prisma.Sql fragments (the CTE) exactly as Prisma binds them.
      sqlValues.push(Prisma.sql(strings, ...values).values);
      if (text.includes('analytics_children_conditions_children')) return rows.children ?? [];
      if (text.includes('analytics_children_conditions_latest_screening'))
        return rows.screenings ?? [];
      if (text.includes('analytics_children_conditions_latest_height')) return rows.heights ?? [];
      return [];
    },
  };
}

const service = (prisma: ReturnType<typeof createPrisma>) =>
  new ChildrenConditionsService(prisma as never);

async function main() {
  await assert('suppresses affected and rate below the minimum denominator', () => {
    eq(conditionMeasure(3, CONDITION_MIN_DENOMINATOR - 1), {
      denominator: CONDITION_MIN_DENOMINATOR - 1,
      affected: null,
      rate: null,
    });
    eq(conditionMeasure(3, 12), { denominator: 12, affected: 3, rate: 25 });
  });

  await assert('tallies each WHO indicator per area on −2 SD', () => {
    const tallies = tallyConditionsByArea(
      [
        screening('c1', 'a', { weight: -2.5, muac: 0 }),
        screening('c2', 'a', { weight: 0, muac: -2.5 }),
        screening('c3', 'b', { weight: 0, muac: 0 }),
      ],
      [height('c1', 'a', 0), height('c3', 'b', -2.5)],
    );
    const a = tallies.get('a');
    const b = tallies.get('b');
    eq(a?.screened, 2, 'a screened');
    eq(a?.underweight, { classified: 2, affected: 1 }, 'a underweight');
    eq(a?.lowMuac, { classified: 2, affected: 1 }, 'a lowMuac');
    eq(a?.stunting, { classified: 1, affected: 0 }, 'a stunting');
    eq(b?.stunting, { classified: 1, affected: 1 }, 'b stunting');
  });

  await assert('any malnutrition counts a child once, across screening and height rows', () => {
    const tallies = tallyConditionsByArea(
      [
        // Underweight and low MUAC and stunted: still one affected child.
        screening('c1', 'a', { weight: -2.5, muac: -2.5 }),
        // Only stunted (from the height row).
        screening('c2', 'a', { weight: 0, muac: 0 }),
        screening('c3', 'a', { weight: 0, muac: 0 }),
      ],
      [height('c1', 'a', -2.5), height('c2', 'a', -2.5)],
    );
    eq(tallies.get('a')?.anyMalnutrition, { classified: 3, affected: 2 });
  });

  await assert('unclassifiable children are left out of every denominator', () => {
    const tallies = tallyConditionsByArea(
      [screening('c1', 'a', { weight: -2.5, muac: -2.5 }, null)],
      [],
    );
    const a = tallies.get('a');
    eq(a?.screened, 1, 'still counted as screened');
    eq(a?.underweight, { classified: 0, affected: 0 });
    eq(a?.anyMalnutrition, { classified: 0, affected: 0 });
  });

  await assert('builds one row per area, sorted, with not-screened and disability', () => {
    const screenings = Array.from({ length: 10 }, (_, i) =>
      screening(`c${i}`, 'a', { weight: i < 2 ? -2.5 : 0, muac: 0 }),
    );
    const items = buildConditionAreaItems(
      [area('a', 'Remera'), area('b', 'Kimironko')],
      [{ areaId: 'a', active: 15, withDisability: 3 }],
      tallyConditionsByArea(screenings, []),
    );
    eq(
      items.map((i) => i.areaName),
      ['Kimironko', 'Remera'],
    );
    const [empty, remera] = items;
    eq(empty.activeChildren, 0);
    eq(empty.notScreened, { denominator: 0, affected: null, rate: null });
    eq(remera.underweight, { denominator: 10, affected: 2, rate: 20 });
    eq(remera.notScreened, { denominator: 15, affected: 5, rate: 33.3 });
    eq(remera.disability, { denominator: 15, affected: 3, rate: 20 });
    // Stunting had no height rows → denominator 0 → withheld.
    eq(remera.stunting, { denominator: 0, affected: null, rate: null });
  });

  await assert('suppression threshold: 10 shown, 9 withheld', () => {
    eq(conditionMeasure(1, 10), { denominator: 10, affected: 1, rate: 10 });
    eq(conditionMeasure(1, 9), { denominator: 9, affected: null, rate: null });
  });

  await assert('disability and not-screened are withheld in areas under 10 children', () => {
    const [item] = buildConditionAreaItems(
      [area('a', 'Remera')],
      [{ areaId: 'a', active: 8, withDisability: 3 }],
      tallyConditionsByArea([screening('c1', 'a', { weight: 0, muac: 0 })], []),
    );
    eq(item.disability, { denominator: 8, affected: null, rate: null });
    eq(item.notScreened, { denominator: 8, affected: null, rate: null });
  });

  await assert('not-screened never goes negative', () => {
    const screenings = Array.from({ length: 12 }, (_, i) =>
      screening(`c${i}`, 'a', { weight: 0, muac: 0 }),
    );
    const [item] = buildConditionAreaItems(
      [area('a', 'Remera')],
      [{ areaId: 'a', active: 10, withDisability: 0 }],
      tallyConditionsByArea(screenings, []),
    );
    eq(item.notScreened, { denominator: 10, affected: 0, rate: 0 });
  });

  await assert('a child with one classifiable indicator still counts for any malnutrition', () => {
    const row = { ...screening('c1', 'a', { weight: -2.5, muac: 0 }), muacCm: null };
    const a = tallyConditionsByArea([row], []).get('a');
    eq(a?.lowMuac, { classified: 0, affected: 0 });
    eq(a?.anyMalnutrition, { classified: 1, affected: 1 });
  });

  await assert('a height-only child counts for stunting and any malnutrition, not screened', () => {
    const a = tallyConditionsByArea([], [height('c1', 'a', -2.5)]).get('a');
    eq(a?.screened, 0);
    eq(a?.stunting, { classified: 1, affected: 1 });
    eq(a?.anyMalnutrition, { classified: 1, affected: 1 });
  });

  await assert('cut-off: just below −2 SD is affected, just above is not', () => {
    const t = tallyConditionsByArea(
      [
        screening('c1', 'a', { weight: -2.01, muac: 0 }),
        screening('c2', 'a', { weight: -1.99, muac: 0 }),
      ],
      [],
    );
    eq(t.get('a')?.underweight, { classified: 2, affected: 1 });
  });

  await assert('sector and caregiver roles are refused', async () => {
    await rejects(
      () =>
        service(createPrisma()).getChildrenConditions(
          user({ role: UserRole.sector_focal_person, districtId: 'd1', sectorId: 's1' }),
          {},
        ),
      ForbiddenException,
    );
    await rejects(
      () =>
        service(createPrisma()).getChildrenConditions(
          user({ role: UserRole.caregiver, centerId: 'x' }),
          {},
        ),
      ForbiddenException,
    );
  });

  await assert('district focal person cannot query another district', async () => {
    await rejects(
      () =>
        service(createPrisma()).getChildrenConditions(
          user({ role: UserRole.district_focal_person, districtId: 'd1' }),
          { districtId: 'd2' },
        ),
      ForbiddenException,
    );
  });

  await assert('district focal person is pinned to their district in every query', async () => {
    const prisma = createPrisma();
    const res = await service(prisma).getChildrenConditions(
      user({ role: UserRole.district_focal_person, districtId: 'd1' }),
      { districtId: 'd1' },
    );
    eq(res.districtId, 'd1');
    eq(prisma.sqlValues.length, 3, 'raw queries');
    for (const values of prisma.sqlValues) {
      if (!values.includes('d1')) throw new Error('raw query ran without the district filter');
    }
  });

  await assert('NCDA national view runs unfiltered queries', async () => {
    const prisma = createPrisma();
    await service(prisma).getChildrenConditions(user({ role: UserRole.ncda_admin }), {});
    eq(prisma.sqlValues.length, 3, 'raw queries');
    for (const values of prisma.sqlValues) {
      if (values.includes('d1') || values.includes('d2'))
        throw new Error('unexpected district filter');
    }
  });

  await assert('district focal person without an assignment is refused', async () => {
    await rejects(
      () =>
        service(createPrisma()).getChildrenConditions(
          user({ role: UserRole.district_focal_person }),
          {},
        ),
      ForbiddenException,
    );
  });

  await assert('unknown district is NotFound at both levels', async () => {
    for (const level of ['district', 'sector'] as const) {
      await rejects(
        () =>
          service(createPrisma()).getChildrenConditions(user({ role: UserRole.ncda_admin }), {
            level,
            districtId: 'nope',
          }),
        NotFoundException,
      );
    }
  });

  await assert('NCDA sector level requires a district', async () => {
    await rejects(
      () =>
        service(createPrisma()).getChildrenConditions(user({ role: UserRole.ncda_admin }), {
          level: 'sector',
        }),
      BadRequestException,
    );
  });

  await assert('NCDA national district view lists every district', async () => {
    const res = await service(
      createPrisma({ children: [{ areaId: 'd1', active: 20, withDisability: 1 }] }),
    ).getChildrenConditions(user({ role: UserRole.ncda_admin }), {});
    eq(
      res.items.map((i) => [i.areaName, i.activeChildren]),
      [
        ['Bugesera', 0],
        ['Gasabo', 20],
      ],
    );
    eq(res.minDenominator, CONDITION_MIN_DENOMINATOR);
  });

  await assert('NCDA sector view keeps sectors missing from the district list', async () => {
    const prisma = createPrisma({
      children: [
        { areaId: 's1', active: 12, withDisability: 0 },
        { areaId: 's9', active: 11, withDisability: 0 },
      ],
    });
    prisma.administrativeUnit.findMany = (async (args: { where: { id?: unknown } }) =>
      args.where.id
        ? [{ id: 's9', name: 'Unlinked', code: '110299' }]
        : [{ id: 's1', name: 'Kimironko', code: '110203' }]) as never;
    const res = await service(prisma).getChildrenConditions(user({ role: UserRole.ncda_admin }), {
      level: 'sector',
      districtId: 'd1',
    });
    eq(
      res.items.map((i) => [i.areaName, i.districtName, i.activeChildren]),
      [
        ['Kimironko', 'Gasabo', 12],
        ['Unlinked', 'Gasabo', 11],
      ],
    );
  });

  await assert('accepts exactly 366 days and rejects 367', async () => {
    await service(createPrisma()).getChildrenConditions(user({ role: UserRole.ncda_admin }), {
      from: new Date('2025-01-01'),
      to: new Date('2026-01-02'),
    });
    await rejects(
      () =>
        service(createPrisma()).getChildrenConditions(user({ role: UserRole.ncda_admin }), {
          from: new Date('2025-01-01'),
          to: new Date('2026-01-03'),
        }),
      BadRequestException,
    );
  });

  await assert('rejects ranges longer than a year', async () => {
    await rejects(
      () =>
        service(createPrisma()).getChildrenConditions(user({ role: UserRole.ncda_admin }), {
          from: new Date('2024-01-01'),
          to: new Date('2026-01-01'),
        }),
      BadRequestException,
    );
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

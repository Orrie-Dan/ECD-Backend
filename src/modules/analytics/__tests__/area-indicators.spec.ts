/**
 * Area indicators (sector / center grain) tests.
 * Run: npx ts-node src/modules/analytics/__tests__/area-indicators.spec.ts
 */
import { ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { UserRole } from '../../../common/domain';
import { AuthUser } from '../../auth/interfaces/jwt-payload.interface';
import { whoSdCutoff } from '../../nutrition/who/classify';
import { AreaIndicatorsService } from '../area-indicators.service';

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
  if (a !== e) throw new Error(`${label ?? 'eq'} expected ${e} got ${a}`);
}

async function rejects(fn: () => Promise<unknown>, type: new (...args: never[]) => Error) {
  try {
    await fn();
  } catch (e) {
    if (e instanceof type) return;
    throw new Error(`expected ${type.name}, got ${String(e)}`);
  }
  throw new Error(`expected ${type.name}, resolved`);
}

function user(partial: Partial<AuthUser> & Pick<AuthUser, 'role'>): AuthUser {
  return {
    id: 'user-1',
    username: 'u',
    email: null,
    fullName: 'U',
    role: partial.role,
    centerId: null,
    districtId: partial.districtId ?? null,
    sectorId: null,
    status: 'active',
  };
}

// Boy aged 24 months at screening; weight at the given WHO z-score, normal MUAC.
const at = (indicator: Parameters<typeof whoSdCutoff>[0], z: number) =>
  whoSdCutoff(indicator, 'boys', 24, z) as number;
const screening = (areaId: string, weightZ: number) => ({
  areaId,
  dateOfBirth: new Date('2024-01-01'),
  gender: 'male',
  screeningDate: new Date('2026-01-01'),
  weightKg: at('weight_for_age', weightZ),
  heightCm: null,
  muacCm: at('muac_for_age', 0),
});

type Rows = Partial<
  Record<
    'areas' | 'children' | 'attendance' | 'nutrition' | 'referrals' | 'sted' | 'selfEval',
    unknown[]
  >
>;

/** Fake Prisma: returns canned rows per query tag and records the bound SQL values. */
function createPrisma(rows: Rows) {
  const queries: Array<{ text: string; values: unknown[] }> = [];
  return {
    queries,
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = Prisma.sql(strings, ...values);
      queries.push({ text: sql.sql, values: sql.values });
      const text = sql.sql;
      if (text.includes('analytics_area_indicators_centers')) return rows.areas ?? [];
      if (text.includes('analytics_area_indicators_sectors')) return rows.areas ?? [];
      if (text.includes('analytics_area_indicators_children')) return rows.children ?? [];
      if (text.includes('analytics_area_indicators_attendance')) return rows.attendance ?? [];
      if (text.includes('analytics_area_indicators_nutrition')) return rows.nutrition ?? [];
      if (text.includes('analytics_area_indicators_referrals')) return rows.referrals ?? [];
      if (text.includes('analytics_area_indicators_sted')) return rows.sted ?? [];
      if (text.includes('analytics_area_indicators_self_eval')) return rows.selfEval ?? [];
      return [];
    },
  };
}

const service = (prisma: ReturnType<typeof createPrisma>) =>
  new AreaIndicatorsService(prisma as never);

const sector = (areaId: string, areaName: string) => ({
  areaId,
  areaName,
  areaCode: areaId.toUpperCase(),
  districtId: 'd1',
  districtName: 'Gasabo',
  latitude: null,
  longitude: null,
});

async function main() {
  await assert('rolls the four indicators up per sector, sorted by name', async () => {
    const prisma = createPrisma({
      areas: [sector('s2', 'Remera'), sector('s1', 'Kimironko')],
      children: [{ areaId: 's1', cnt: 40 }],
      attendance: [{ areaId: 's1', present: 90, absent: 10 }],
      nutrition: [screening('s1', -3.5), screening('s1', -2.5), screening('s1', 0)],
      referrals: [{ areaId: 's1', cnt: 2 }],
      sted: [{ areaId: 's1', cnt: 10 }],
      selfEval: [{ areaId: 's1', avgPercent: '68.333', cnt: 3 }],
    });
    const res = await service(prisma).getAreaIndicators(user({ role: UserRole.ncda_admin }), {
      level: 'sector',
    });
    eq(res.level, 'sector');
    eq(res.districtId, null);
    eq(res.total, 2);
    eq(
      res.items.map((i) => i.areaName),
      ['Kimironko', 'Remera'],
      'sorted',
    );
    const [kimironko, remera] = res.items;
    eq(kimironko.activeChildren, 40);
    eq(kimironko.attendanceRate, 90);
    eq(kimironko.attendanceRecords, 100);
    eq(kimironko.nutritionScreenings, 3);
    // Only below −3 SD is severe; −2.5 SD is moderate.
    eq(kimironko.severeNutritionCount, 1, 'severe');
    eq(kimironko.pendingReferralCount, 2);
    eq(kimironko.stedChildrenAssessed, 10);
    eq(kimironko.stedCoverage, 25);
    eq(kimironko.selfEvalPercent, 68.3, 'self-eval mean');
    eq(kimironko.selfEvalCentersEvaluated, 3);
    // An area with centers but no activity reads as empty, not missing.
    eq(remera.activeChildren, 0);
    eq(remera.attendanceRate, null);
    eq(remera.stedCoverage, null);
    eq(remera.nutritionScreenings, 0);
    eq(remera.selfEvalPercent, null);
    eq(remera.selfEvalCentersEvaluated, 0);
  });

  await assert('center level lists centers with coordinates', async () => {
    const prisma = createPrisma({
      areas: [
        {
          areaId: 'c1',
          areaName: 'ECD Umucyo',
          areaCode: 'ECD-001',
          districtId: 'd1',
          districtName: 'Gasabo',
          latitude: -1.95,
          longitude: 30.1,
        },
      ],
      children: [{ areaId: 'c1', cnt: 20 }],
    });
    const res = await service(prisma).getAreaIndicators(user({ role: UserRole.ncda_admin }), {
      level: 'center',
    });
    eq(res.level, 'center');
    eq([res.items[0].latitude, res.items[0].longitude], [-1.95, 30.1]);
    eq(res.items[0].activeChildren, 20);
    eq(
      prisma.queries.some((q) => q.text.includes('analytics_area_indicators_centers')),
      true,
      'center area query',
    );
  });

  await assert('defaults to sector level', async () => {
    const res = await service(createPrisma({})).getAreaIndicators(
      user({ role: UserRole.ncda_admin }),
      {},
    );
    eq(res.level, 'sector');
  });

  await assert('NCDA district filter is bound into every query', async () => {
    const prisma = createPrisma({});
    const res = await service(prisma).getAreaIndicators(user({ role: UserRole.ncda_admin }), {
      districtId: 'd9',
    });
    eq(res.districtId, 'd9');
    eq(prisma.queries.length, 7, 'raw queries');
    for (const q of prisma.queries) eq(q.values.includes('d9'), true, 'district bound');
  });

  await assert('sector filter is bound into every query at both grains', async () => {
    for (const level of ['sector', 'center'] as const) {
      const prisma = createPrisma({});
      const res = await service(prisma).getAreaIndicators(user({ role: UserRole.ncda_admin }), {
        level,
        districtId: 'd9',
        sectorId: 's7',
      });
      eq(res.sectorId, 's7', `${level} echoes sector`);
      eq(prisma.queries.length, 7, `${level} raw queries`);
      for (const q of prisma.queries) {
        eq(q.values.includes('s7'), true, `${level} sector bound`);
        eq(q.values.includes('d9'), true, `${level} district bound`);
        eq(q.text.includes('WITH RECURSIVE up'), true, `${level} walks to the sector`);
      }
    }
  });

  await assert('no sector filter leaves center level on the flat CTE', async () => {
    const prisma = createPrisma({});
    const res = await service(prisma).getAreaIndicators(user({ role: UserRole.ncda_admin }), {
      level: 'center',
    });
    eq(res.sectorId, null);
    for (const q of prisma.queries) eq(q.text.includes('WITH RECURSIVE'), false, 'flat cte');
  });

  await assert('district focal person is pinned to their district', async () => {
    const prisma = createPrisma({});
    const res = await service(prisma).getAreaIndicators(
      user({ role: UserRole.district_focal_person, districtId: 'd1' }),
      {},
    );
    eq(res.districtId, 'd1');
    for (const q of prisma.queries) eq(q.values.includes('d1'), true, 'district bound');
  });

  await assert('district focal person cannot read another district', async () => {
    await rejects(
      () =>
        service(createPrisma({})).getAreaIndicators(
          user({ role: UserRole.district_focal_person, districtId: 'd1' }),
          { districtId: 'd2' },
        ),
      ForbiddenException,
    );
  });

  await assert('other roles are refused', async () => {
    for (const role of [UserRole.sector_focal_person, UserRole.ecd_director, UserRole.caregiver]) {
      await rejects(
        () => service(createPrisma({})).getAreaIndicators(user({ role, districtId: 'd1' }), {}),
        ForbiddenException,
      );
    }
  });
}

main().catch(() => process.exit(1));

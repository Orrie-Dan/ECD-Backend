/**
 * Center metrics (GIS map) tests.
 * Run: npx ts-node src/modules/gis/__tests__/center-metrics.spec.ts
 */
import { UserRole } from '../../../common/domain';
import { AuthUser } from '../../auth/interfaces/jwt-payload.interface';
import { whoSdCutoff } from '../../nutrition/who/classify';
import {
  STUNTING_MIN_SCREENED,
  buildCenterMetricItems,
  stuntingRate,
  tallyStuntingByCenter,
  type HeightScreeningRow,
} from '../center-metrics/center-metrics.calc';
import {
  CenterDirectoryCache,
  filterCentersForScope,
  type CenterDirectoryRow,
} from '../center-metrics/center-directory.cache';
import { CenterMetricsService } from '../center-metrics/center-metrics.service';
import type { DistrictQueryScope } from '../../../common/scope/district-query.scope';

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

async function rejects(fn: () => Promise<unknown>, status: number, label: string) {
  try {
    await fn();
  } catch (e) {
    const got = (e as { getStatus?: () => number }).getStatus?.();
    eq(got, status, label);
    return;
  }
  throw new Error(`${label}: expected rejection with ${status}`);
}

function user(partial: Partial<AuthUser> & Pick<AuthUser, 'role'>): AuthUser {
  return {
    id: 'u1',
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

const DISTRICT_A = '11111111-1111-4111-8111-111111111111';
const DISTRICT_B = '22222222-2222-4222-8222-222222222222';
const PROVINCE_A = '33333333-3333-4333-8333-333333333333';
const PROVINCE_B = '44444444-4444-4444-8444-444444444444';
const VILLAGE_A = '55555555-5555-4555-8555-555555555555';

// Boys aged exactly 24 months at screening.
const DOB = '2024-10-01';
const SCREENED_ON = '2026-10-01';
const STUNTED_CM = (whoSdCutoff('height_for_age', 'boys', 24, -2) as number) - 1;
const NORMAL_CM = whoSdCutoff('height_for_age', 'boys', 24, 0) as number;

function heightRow(
  centerId: string,
  heightCm: number | null,
  dob: string | null = DOB,
): HeightScreeningRow {
  return { centerId, dateOfBirth: dob, gender: 'male', screeningDate: SCREENED_ON, heightCm };
}

function directoryRow(
  partial: Partial<CenterDirectoryRow> & Pick<CenterDirectoryRow, 'id'>,
): CenterDirectoryRow {
  return {
    code: partial.id.toUpperCase(),
    name: partial.id,
    status: 'active',
    latitude: -1.95,
    longitude: 30.06,
    districtId: DISTRICT_A,
    villageId: VILLAGE_A,
    provinceId: PROVINCE_A,
    ...partial,
  };
}

function scope(partial: Partial<DistrictQueryScope>): DistrictQueryScope {
  return {
    centerIds: 'all',
    provinceId: null,
    districtId: null,
    sectorId: null,
    cellId: null,
    villageId: null,
    singleCenterId: null,
    ...partial,
  };
}

/** Prisma row shape for the directory select (province via the district relation). */
function prismaCenter(row: CenterDirectoryRow) {
  const { provinceId, ...center } = row;
  return { ...center, district: { provinceId } };
}

function stubPrisma() {
  const rawSql: string[] = [];
  const rawValues: unknown[][] = [];
  const findManyWhere: unknown[] = [];
  /** Mutable so tests can simulate center writes between requests. */
  const fingerprint = {
    active: 3,
    updatedAt: new Date('2026-10-01T00:00:00Z'),
    deletedAt: null as Date | null,
  };
  /** Rows returned by an incremental (changed-since) query; includes `deletedAt`. */
  const delta: Array<ReturnType<typeof prismaCenter> & { deletedAt: Date | null }> = [];
  return {
    rawSql,
    rawValues,
    findManyWhere,
    fingerprint,
    delta,
    ecdCenter: {
      count: async () => fingerprint.active,
      aggregate: async () => ({
        _max: { updatedAt: fingerprint.updatedAt, deletedAt: fingerprint.deletedAt },
      }),
      findMany: async (args: { where: { OR?: unknown } }) => {
        findManyWhere.push(args.where);
        if (args.where.OR) return delta;
        return [
          prismaCenter(directoryRow({ id: 'c1', code: 'C1', name: 'Alpha' })),
          prismaCenter(
            directoryRow({ id: 'c2', code: 'C2', name: 'Beta', latitude: null, longitude: 30.1 }),
          ),
          prismaCenter(
            directoryRow({
              id: 'c3',
              code: 'C3',
              name: 'Gamma',
              districtId: DISTRICT_B,
              provinceId: PROVINCE_B,
            }),
          ),
        ];
      },
    },
    child: {
      groupBy: async () => [{ centerId: 'c1', _count: { _all: 12 } }],
    },
    attendanceRecord: {
      groupBy: async () => [
        { centerId: 'c1', status: 'present', _count: { _all: 9 } },
        { centerId: 'c1', status: 'absent', _count: { _all: 1 } },
      ],
    },
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join('?');
      rawSql.push(sql);
      rawValues.push(values);
      if (sql.includes('gis_center_metrics_latest_self_evals')) {
        return [
          {
            center_id: 'c1',
            overall_percent: '84.50',
            overall_rank: 'blue',
            assessment_date: new Date('2026-09-01'),
          },
        ];
      }
      if (sql.includes('gis_center_metrics_latest_height')) {
        return Array.from({ length: STUNTING_MIN_SCREENED }, (_, i) => ({
          center_id: 'c1',
          date_of_birth: new Date(DOB),
          gender: 'male',
          screening_date: new Date(SCREENED_ON),
          height_cm: i < 3 ? String(STUNTED_CM) : String(NORMAL_CM),
        }));
      }
      throw new Error(`unexpected raw query: ${sql}`);
    },
  };
}

function service(prisma: ReturnType<typeof stubPrisma>) {
  return new CenterMetricsService(prisma as never, new CenterDirectoryCache(prisma as never));
}

function flattenValues(values: unknown[]): string {
  // Nested Prisma.Sql fragments expose their bound parameters on `.values`.
  return JSON.stringify(values, (_k, v) =>
    v && typeof v === 'object' && !Array.isArray(v) && Array.isArray(v.values) ? v.values : v,
  );
}

async function main() {
  await assert('stunting tally counts < −2 SD and skips unclassifiable rows', () => {
    const tallies = tallyStuntingByCenter([
      heightRow('c1', STUNTED_CM),
      heightRow('c1', NORMAL_CM),
      heightRow('c1', NORMAL_CM, null), // missing DOB → excluded from denominator
      heightRow('c1', null), // missing height → excluded
    ]);
    eq(tallies.get('c1'), { screened: 2, stunted: 1 });
  });

  await assert('stunting rate suppressed below minimum screened', () => {
    eq(stuntingRate({ screened: STUNTING_MIN_SCREENED - 1, stunted: 5 }), null);
    eq(stuntingRate({ screened: STUNTING_MIN_SCREENED, stunted: 3 }), 30);
    eq(stuntingRate(undefined), null);
  });

  await assert('items skip unmapped centers and default missing metrics', () => {
    const { items, unmappedCount } = buildCenterMetricItems({
      centers: [
        { id: 'a', code: 'A', name: 'A', status: 'active', latitude: 1, longitude: 2 },
        { id: 'b', code: 'B', name: 'B', status: 'active', latitude: 91, longitude: 2 },
        { id: 'c', code: 'C', name: 'C', status: 'active', latitude: null, longitude: null },
      ],
      enrolledByCenter: new Map(),
      presentByCenter: new Map(),
      absentByCenter: new Map(),
      selfEvalByCenter: new Map(),
      stuntingByCenter: new Map(),
    });
    eq(unmappedCount, 2);
    eq(items.length, 1);
    eq(
      [
        items[0].enrolledChildren,
        items[0].attendanceRate,
        items[0].selfEvalPercent,
        items[0].stuntingRate,
      ],
      [0, null, null, null],
    );
  });

  await assert('ncda national request returns every center (country view)', async () => {
    const prisma = stubPrisma();
    const svc = service(prisma);
    const res = await svc.centerMetrics(user({ role: UserRole.ncda_admin }), {});
    eq([res.districtId, res.sectorId], [null, null], 'scope');
    eq(
      res.items.map((i) => i.centerId),
      ['c1', 'c3'],
      'every mapped center',
    );
    eq(res.unmappedCount, 1, 'unmapped');
    eq(prisma.findManyWhere[0], { deletedAt: null }, 'center where');
    eq(prisma.rawSql.length, 2, 'raw queries');
    for (const values of prisma.rawValues) {
      // Nested Prisma.Sql fragment serialises its own strings — national scope is `TRUE`.
      if (!JSON.stringify(values).includes('TRUE')) {
        throw new Error('national raw query should be unfiltered');
      }
    }
  });

  await assert('ncda province request scopes raw queries to the province', async () => {
    const prisma = stubPrisma();
    const svc = service(prisma);
    const res = await svc.centerMetrics(user({ role: UserRole.ncda_admin }), {
      provinceId: PROVINCE_A,
    });
    eq(
      res.items.map((i) => i.centerId),
      ['c1'],
      'province centers',
    );
    eq(res.unmappedCount, 1, 'province unmapped');
    for (const values of prisma.rawValues) {
      if (!flattenValues(values).includes(PROVINCE_A)) {
        throw new Error('raw query not scoped to province');
      }
    }
  });

  await assert('range longer than a year is rejected', async () => {
    const svc = service(stubPrisma());
    await rejects(
      () =>
        svc.centerMetrics(user({ role: UserRole.ncda_admin }), {
          districtId: DISTRICT_A,
          from: new Date('2025-01-01'),
          to: new Date('2026-06-01'),
        }),
      400,
      'range',
    );
  });

  await assert('district officer cannot query another district', async () => {
    const svc = service(stubPrisma());
    await rejects(
      () =>
        svc.centerMetrics(user({ role: UserRole.district_focal_person, districtId: DISTRICT_A }), {
          districtId: DISTRICT_B,
        }),
      403,
      'foreign district',
    );
  });

  await assert('district officer is pinned to own district in every query', async () => {
    const prisma = stubPrisma();
    const svc = service(prisma);
    const res = await svc.centerMetrics(
      user({ role: UserRole.district_focal_person, districtId: DISTRICT_A }),
      {},
    );
    eq(
      res.items.map((i) => i.centerId),
      ['c1'],
      'own district centers only',
    );
    eq(prisma.rawSql.length, 2, 'raw queries');
    for (const values of prisma.rawValues) {
      if (!flattenValues(values).includes(DISTRICT_A)) {
        throw new Error('raw query not scoped to district');
      }
      if (flattenValues(values).includes(DISTRICT_B)) {
        throw new Error('raw query leaked foreign district');
      }
    }
  });

  await assert('response assembles per-center aggregates with no child-level fields', async () => {
    const prisma = stubPrisma();
    const svc = service(prisma);
    const res = await svc.centerMetrics(user({ role: UserRole.ncda_admin }), {
      districtId: DISTRICT_A,
    });
    eq(res.unmappedCount, 1);
    eq(res.items.length, 1);
    const item = res.items[0];
    eq(
      [
        item.enrolledChildren,
        item.attendanceRate,
        item.attendanceRecords,
        item.selfEvalPercent,
        item.selfEvalRank,
        item.selfEvalDate,
      ],
      [12, 90, 10, 84.5, 'blue', '2026-09-01'],
    );
    eq([item.stuntingRate, item.stuntingScreened], [30, STUNTING_MIN_SCREENED]);
    eq(
      Object.keys(item).sort(),
      [
        'attendanceRate',
        'attendanceRecords',
        'centerId',
        'code',
        'enrolledChildren',
        'latitude',
        'longitude',
        'name',
        'selfEvalDate',
        'selfEvalPercent',
        'selfEvalRank',
        'status',
        'stuntingRate',
        'stuntingScreened',
      ],
      'item keys',
    );
  });

  await assert('self-eval query only uses submitted/verified self-assessments', async () => {
    const prisma = stubPrisma();
    const svc = service(prisma);
    await svc.centerMetrics(user({ role: UserRole.ncda_admin }), { districtId: DISTRICT_A });
    const sql = prisma.rawSql.find((s) => s.includes('gis_center_metrics_latest_self_evals')) ?? '';
    if (
      !sql.includes(`assessment_type = 'self_assessment'`) ||
      !sql.includes(`status IN ('submitted', 'verified')`)
    ) {
      throw new Error('self-eval filter missing');
    }
  });

  await assert('scope filter mirrors ecdCenterWhere precedence', () => {
    const rows = [
      directoryRow({ id: 'a' }),
      directoryRow({ id: 'b', villageId: 'other-village' }),
      directoryRow({
        id: 'c',
        districtId: DISTRICT_B,
        provinceId: PROVINCE_B,
        villageId: 'village-c',
      }),
    ];
    const ids = (s: DistrictQueryScope) => filterCentersForScope(rows, s).map((r) => r.id);
    eq(ids(scope({})), ['a', 'b', 'c'], 'national');
    eq(ids(scope({ provinceId: PROVINCE_B })), ['c'], 'province');
    eq(ids(scope({ provinceId: PROVINCE_B, districtId: DISTRICT_A })), ['a', 'b'], 'district wins');
    eq(ids(scope({ districtId: DISTRICT_A, villageId: VILLAGE_A })), ['a'], 'village wins');
    eq(ids(scope({ centerIds: ['a', 'c'] })), ['a', 'c'], 'center ids');
    eq(
      ids(scope({ centerIds: ['a', 'c'], districtId: DISTRICT_A })),
      ['a'],
      'center ids in district',
    );
    eq(ids(scope({ centerIds: [] })), [], 'empty center ids');
    eq(ids(scope({ singleCenterId: 'b', districtId: DISTRICT_B })), ['b'], 'single center wins');
  });

  await assert('directory is cached until the center fingerprint changes', async () => {
    const prisma = stubPrisma();
    const svc = service(prisma);
    const ncda = user({ role: UserRole.ncda_admin });
    await svc.centerMetrics(ncda, {});
    await svc.centerMetrics(ncda, { districtId: DISTRICT_A });
    eq(prisma.findManyWhere.length, 1, 'second request served from cache');
  });

  await assert('center writes are applied incrementally', async () => {
    const prisma = stubPrisma();
    const svc = service(prisma);
    const ncda = user({ role: UserRole.ncda_admin });
    await svc.centerMetrics(ncda, {});

    // c1 renamed + moved; c4 added (Survey123 sync); c3 soft-deleted.
    const editedAt = new Date('2026-10-02T00:00:00Z');
    prisma.delta.push(
      {
        ...prismaCenter(directoryRow({ id: 'c1', name: 'Alpha 2', latitude: -2 })),
        deletedAt: null,
      },
      { ...prismaCenter(directoryRow({ id: 'c4', name: 'Delta' })), deletedAt: null },
      {
        ...prismaCenter(directoryRow({ id: 'c3', districtId: DISTRICT_B, provinceId: PROVINCE_B })),
        deletedAt: editedAt,
      },
    );
    prisma.fingerprint.updatedAt = editedAt;
    prisma.fingerprint.deletedAt = editedAt;
    const res = await svc.centerMetrics(ncda, {});

    eq(prisma.findManyWhere.length, 2, 'one incremental query');
    eq(
      prisma.findManyWhere[1],
      {
        OR: [{ updatedAt: { gt: new Date('2026-10-01T00:00:00Z') } }, { deletedAt: { not: null } }],
      },
      'changed-since filter',
    );
    eq(
      res.items.map((i) => [i.centerId, i.name, i.latitude]),
      [
        ['c1', 'Alpha 2', -2],
        ['c4', 'Delta', -1.95],
      ],
      'edited, added and deleted centers',
    );
  });

  await assert('a delta that does not reconcile falls back to a full load', async () => {
    const prisma = stubPrisma();
    const cache = new CenterDirectoryCache(prisma as never);
    const all = scope({});
    await cache.centersFor(all);

    // Count grew but nothing shows as changed (e.g. back-dated insert).
    prisma.fingerprint.active = 4;
    await cache.centersFor(all);
    eq(prisma.findManyWhere.length, 3, 'full + delta + full');
    eq(prisma.findManyWhere[2], { deletedAt: null }, 'full reload');
  });

  await assert('concurrent cache misses share one directory load', async () => {
    const prisma = stubPrisma();
    const cache = new CenterDirectoryCache(prisma as never);
    const all = scope({});
    await Promise.all([cache.centersFor(all), cache.centersFor(all), cache.centersFor(all)]);
    eq(prisma.findManyWhere.length, 1, 'single load');
  });

  console.log('\nAll center metrics tests passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

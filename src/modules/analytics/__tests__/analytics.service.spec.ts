/**
 * Analytics dashboard tests.
 * Run: npx ts-node src/modules/analytics/__tests__/analytics.service.spec.ts
 */
import { UserRole } from '../../../common/domain';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { AuthUser } from '../../auth/interfaces/jwt-payload.interface';
import { AnalyticsService } from '../analytics.service';

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

function createPrisma(counts: {
  children?: number[];
  attendance?: number[];
  nutritionGroup?: Array<{ nutritionStatus: string; _count: { _all: number } }>;
  nutritionReferral?: number;
  referrals?: number[];
  feeding?: number[];
  feedingCenters?: string[];
  attendanceCenters?: string[];
  centers?: string[];
  /** Sector admin unit district ownership for validation. */
  sectorDistrictId?: string | null;
  sectorVillages?: Array<{ id: string; level: string }>;
}) {
  let childIdx = 0;
  let attIdx = 0;
  let refIdx = 0;
  let feedIdx = 0;
  let distinctCalls = 0;
  let adminLookupCalls = 0;

  /** Expand legacy nutritionGroup counts into WHO-classifiable screening rows. */
  function nutritionRowsFromGroup() {
    const rows: Array<{
      weightKg: number;
      heightCm: number;
      muacCm: number;
      screeningDate: Date;
      child: { dateOfBirth: Date; gender: string };
    }> = [];
    const child = { dateOfBirth: new Date('2022-01-01'), gender: 'male' };
    const date = new Date('2024-01-01');
    for (const g of counts.nutritionGroup ?? []) {
      const n = g._count._all;
      for (let i = 0; i < n; i += 1) {
        if (g.nutritionStatus === 'severe') {
          rows.push({ weightKg: 5, heightCm: 70, muacCm: 10, screeningDate: date, child });
        } else if (g.nutritionStatus === 'moderate') {
          // Mid between -3 and -2 SD for weight ≈ 8.5 at 24m boys (approx)
          rows.push({ weightKg: 8.5, heightCm: 80, muacCm: 12.5, screeningDate: date, child });
        } else {
          rows.push({ weightKg: 12, heightCm: 86, muacCm: 15, screeningDate: date, child });
        }
      }
    }
    return rows;
  }

  return {
    ecdCenter: {
      count: async () => counts.centers?.length ?? 2,
      findMany: async () => (counts.centers ?? ['c1', 'c2']).map((id) => ({ id })),
      findFirst: async ({ where }: { where: { id: string } }) => ({
        id: where.id,
        districtId: 'd1',
      }),
    },
    administrativeUnit: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        adminLookupCalls += 1;
        if (adminLookupCalls === 1 && counts.sectorDistrictId !== undefined) {
          return {
            id: where.id,
            districtId: counts.sectorDistrictId,
            level: 'sector',
          };
        }
        return {
          id: where.id,
          districtId: counts.sectorDistrictId ?? 'd1',
          level: 'sector',
        };
      },
      findMany: async () => counts.sectorVillages ?? [{ id: 'v1', level: 'village' }],
    },
    child: {
      count: async () => {
        const v = counts.children?.[childIdx] ?? 0;
        childIdx += 1;
        return v;
      },
    },
    attendanceRecord: {
      count: async () => {
        const v = counts.attendance?.[attIdx] ?? 0;
        attIdx += 1;
        return v;
      },
    },
    childNutritionScreening: {
      findMany: async () => nutritionRowsFromGroup(),
      groupBy: async () => counts.nutritionGroup ?? [],
      count: async () => counts.nutritionReferral ?? 0,
    },
    referral: {
      count: async () => {
        const v = counts.referrals?.[refIdx] ?? 0;
        refIdx += 1;
        return v;
      },
    },
    centerFeedingDay: {
      count: async () => {
        const v = counts.feeding?.[feedIdx] ?? 0;
        feedIdx += 1;
        return v;
      },
    },
    $queryRaw: async () => {
      const list =
        distinctCalls === 0
          ? (counts.attendanceCenters ?? ['c1'])
          : (counts.feedingCenters ?? ['c1']);
      distinctCalls += 1;
      return [{ cnt: list.length }];
    },
  };
}

async function main() {
  await assert('national dashboard unchanged (ncda, no geo filters)', async () => {
    const prisma = createPrisma({
      centers: ['c1', 'c2', 'c3'],
      children: [300, 250, 20, 30],
      attendance: [200, 50],
      attendanceCenters: ['c1', 'c2'],
      nutritionGroup: [{ nutritionStatus: 'normal', _count: { _all: 10 } }],
      nutritionReferral: 1,
      referrals: [5, 2, 2, 1],
      feeding: [10, 5, 5, 3],
      feedingCenters: ['c1'],
    });
    // National scope uses centerIds 'all' — count without id filter
    prisma.ecdCenter.findMany = async () => {
      throw new Error('national scope must not list all centers');
    };

    const result = await new AnalyticsService(prisma as never).getDashboard(
      user({ role: UserRole.ncda_admin }),
      {
        from: new Date('2026-08-01'),
        to: new Date('2026-08-05'),
      },
    );

    eq(result.districtId, null);
    eq(result.sectorId, null);
    eq(result.children.active, 250);
    eq(result.centersInScope, 3);
  });

  await assert('district dashboard unchanged', async () => {
    const prisma = createPrisma({
      centers: ['c1', 'c2'],
      children: [100, 80, 10, 10],
      attendance: [70, 30],
      attendanceCenters: ['c1', 'c2'],
      nutritionGroup: [
        { nutritionStatus: 'normal', _count: { _all: 40 } },
        { nutritionStatus: 'severe', _count: { _all: 5 } },
      ],
      nutritionReferral: 3,
      referrals: [8, 4, 3, 1],
      feeding: [20, 10, 12, 8],
      feedingCenters: ['c1'],
    });

    const result = await new AnalyticsService(prisma as never).getDashboard(
      user({ role: UserRole.district_focal_person, districtId: 'd1' }),
      {
        from: new Date('2026-08-01'),
        to: new Date('2026-08-05'),
      },
    );

    eq(result.children.total, 100);
    eq(result.children.active, 80);
    eq(result.attendance.present, 70);
    eq(result.attendance.absent, 30);
    eq(result.attendance.rate, 70);
    eq(result.nutrition.screenings, 45);
    eq(result.nutrition.severe, 5);
    eq(result.nutrition.requiresReferral, 3);
    eq(result.referrals.pending, 4);
    eq(result.feeding.daysRecorded, 20);
    eq(result.feeding.daysWithMilk, 10);
    eq(result.centersInScope, 2);
    eq(result.districtId, 'd1');
    eq(result.sectorId, null);
  });

  await assert('sectorId scopes dashboard (district + sector)', async () => {
    const prisma = createPrisma({
      centers: ['c-sector'],
      children: [20, 18, 1, 1],
      attendance: [15, 5],
      attendanceCenters: ['c-sector'],
      nutritionGroup: [{ nutritionStatus: 'severe', _count: { _all: 2 } }],
      nutritionReferral: 1,
      referrals: [3, 1, 1, 0],
      feeding: [4, 2, 2, 1],
      feedingCenters: ['c-sector'],
      sectorDistrictId: 'd1',
      sectorVillages: [{ id: 'v1', level: 'village' }],
    });

    const result = await new AnalyticsService(prisma as never).getDashboard(
      user({ role: UserRole.ncda_admin }),
      {
        districtId: 'd1',
        sectorId: 's1',
        from: new Date('2026-08-01'),
        to: new Date('2026-08-05'),
      },
    );

    eq(result.districtId, 'd1');
    eq(result.sectorId, 's1');
    eq(result.children.active, 18);
    eq(result.attendance.present, 15);
    eq(result.nutrition.severe, 2);
    eq(result.centersInScope, 1);
  });

  await assert('sector outside district rejected', async () => {
    const prisma = createPrisma({
      sectorDistrictId: 'other-district',
      sectorVillages: [{ id: 'v1', level: 'village' }],
    });
    let threw = false;
    try {
      await new AnalyticsService(prisma as never).getDashboard(
        user({ role: UserRole.ncda_admin }),
        { districtId: 'd1', sectorId: 's-other' },
      );
    } catch (e) {
      threw = e instanceof BadRequestException;
    }
    eq(threw, true);
  });

  await assert('district focal cannot query sector outside assigned district', async () => {
    const prisma = createPrisma({
      sectorDistrictId: 'd2',
      sectorVillages: [{ id: 'v1', level: 'village' }],
    });
    let threw = false;
    try {
      await new AnalyticsService(prisma as never).getDashboard(
        user({ role: UserRole.district_focal_person, districtId: 'd1' }),
        { districtId: 'd2', sectorId: 's-musanze' },
      );
    } catch (e) {
      threw =
        e instanceof ForbiddenException || e instanceof BadRequestException;
    }
    eq(threw, true);
  });

  await assert('attendance + nutrition respect period and sector', async () => {
    const prisma = createPrisma({
      centers: ['c-sector'],
      children: [10, 10, 0, 0],
      attendance: [8, 2],
      attendanceCenters: ['c-sector'],
      nutritionGroup: [{ nutritionStatus: 'moderate', _count: { _all: 4 } }],
      nutritionReferral: 0,
      referrals: [0, 0, 0, 0],
      feeding: [0, 0, 0, 0],
      feedingCenters: [],
      sectorDistrictId: 'd1',
    });

    const result = await new AnalyticsService(prisma as never).getDashboard(
      user({ role: UserRole.ncda_admin }),
      {
        districtId: 'd1',
        sectorId: 's1',
        from: new Date('2026-09-01'),
        to: new Date('2026-09-30'),
      },
    );

    eq(result.attendance.totalRecords, 10);
    eq(result.nutrition.screenings, 4);
    eq(result.from.startsWith('2026-09-01'), true);
    eq(result.to.startsWith('2026-09-30'), true);
  });

  await assert('point-in-time children/centers are geographic but not date-filtered', async () => {
    // Children counts ignore from/to; only attendance uses the range.
    // Mock returns fixed children regardless of where — we assert centersInScope
    // comes from scoped center list length (geographic).
    const prisma = createPrisma({
      centers: ['c-sector'],
      children: [7, 7, 0, 0],
      attendance: [0, 0],
      attendanceCenters: [],
      nutritionGroup: [],
      nutritionReferral: 0,
      referrals: [0, 0, 0, 0],
      feeding: [0, 0, 0, 0],
      feedingCenters: [],
      sectorDistrictId: 'd1',
    });

    const result = await new AnalyticsService(prisma as never).getDashboard(
      user({ role: UserRole.ncda_admin }),
      {
        districtId: 'd1',
        sectorId: 's1',
        from: new Date('2020-01-01'),
        to: new Date('2020-01-31'),
      },
    );

    eq(result.children.active, 7);
    eq(result.centersInScope, 1);
    eq(result.attendance.totalRecords, 0);
  });

  await assert('zero-data sector returns zeros, not national fallback', async () => {
    const prisma = createPrisma({
      centers: [],
      sectorDistrictId: 'd1',
      sectorVillages: [{ id: 'v-empty', level: 'village' }],
    });
    prisma.ecdCenter.findMany = async () => [];
    prisma.ecdCenter.count = async () => 0;

    const result = await new AnalyticsService(prisma as never).getDashboard(
      user({ role: UserRole.ncda_admin }),
      { districtId: 'd1', sectorId: 's-empty' },
    );

    eq(result.centersInScope, 0);
    eq(result.children.total, 0);
    eq(result.attendance.rate, null);
    eq(result.sectorId, 's-empty');
    eq(result.districtId, 'd1');
  });

  await assert('caregiver cannot query another center', async () => {
    const service = new AnalyticsService(createPrisma({}) as never);
    let threw = false;
    try {
      await service.getDashboard(user({ role: UserRole.caregiver, centerId: 'c1' }), {
        centerId: 'c2',
      });
    } catch (e) {
      threw = e instanceof ForbiddenException;
    }
    eq(threw, true);
  });

  await assert('rejects inverted date range', async () => {
    const service = new AnalyticsService(createPrisma({ centers: ['c1'] }) as never);
    let threw = false;
    try {
      await service.getDashboard(user({ role: UserRole.ncda_admin }), {
        from: new Date('2026-08-10'),
        to: new Date('2026-08-01'),
      });
    } catch (e) {
      threw = e instanceof BadRequestException;
    }
    eq(threw, true);
  });

  await assert('empty district returns zeroed dashboard', async () => {
    const prisma = createPrisma({ centers: [] });
    prisma.ecdCenter.findMany = async () => [];
    prisma.ecdCenter.count = async () => 0;

    const result = await new AnalyticsService(prisma as never).getDashboard(
      user({ role: UserRole.district_focal_person, districtId: 'empty' }),
      {},
    );

    eq(result.centersInScope, 0);
    eq(result.children.total, 0);
    eq(result.attendance.rate, null);
  });

  console.log('\nAll analytics tests passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

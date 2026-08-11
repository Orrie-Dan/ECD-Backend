/**
 * Monitoring service tests.
 * Run: npx ts-node src/modules/monitoring/__tests__/monitoring.service.spec.ts
 */
import { UserRole } from '@prisma/client';
import { AuthUser } from '../../auth/interfaces/jwt-payload.interface';
import { MonitoringService } from '../monitoring.service';

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
    id: 'u1',
    username: 'u',
    email: null,
    fullName: 'U',
    role: partial.role,
    centerId: partial.centerId ?? null,
    districtId: partial.districtId ?? null,
    status: 'active',
  };
}

function stubPrisma() {
  const callCounts = {
    attendanceCount: 0,
    attendanceGroupBy: 0,
    childCount: 0,
    childGroupBy: 0,
    feedingCount: 0,
    feedingGroupBy: 0,
    referralCount: 0,
    referralGroupBy: 0,
    nutritionGroupBy: 0,
    nutritionQueryRaw: 0,
    centersFindMany: 0,
  };

  const manyCenters = Array.from({ length: 50 }, (_, i) => ({
    id: `c${i + 1}`,
    name: `Center ${i + 1}`,
  }));

  return {
    callCounts,
    ecdCenter: {
      findMany: async () => {
        callCounts.centersFindMany += 1;
        return manyCenters;
      },
      findFirst: async () => ({ id: 'c1', districtId: 'd1', villageId: 'v1' }),
      count: async () => manyCenters.length,
    },
    child: {
      count: async () => {
        callCounts.childCount += 1;
        return 10;
      },
      groupBy: async () => {
        callCounts.childGroupBy += 1;
        return [{ centerId: 'c1', _count: { _all: 10 } }];
      },
      findMany: async () => [],
    },
    attendanceRecord: {
      count: async () => {
        callCounts.attendanceCount += 1;
        return 5;
      },
      groupBy: async () => {
        callCounts.attendanceGroupBy += 1;
        return [
          {
            centerId: 'c1',
            status: 'present',
            attendanceDate: new Date('2026-08-01'),
            _count: { _all: 5 },
          },
        ];
      },
    },
    childNutritionScreening: {
      groupBy: async () => {
        callCounts.nutritionGroupBy += 1;
        return [
          { nutritionStatus: 'severe', _count: { _all: 2 } },
          { nutritionStatus: 'normal', _count: { _all: 8 } },
        ];
      },
      count: async () => 1,
    },
    centerFeedingDay: {
      count: async () => {
        callCounts.feedingCount += 1;
        return 3;
      },
      groupBy: async () => {
        callCounts.feedingGroupBy += 1;
        return [{ centerId: 'c1', _count: { _all: 3 } }];
      },
    },
    stedAssessment: {
      findMany: async () => [
        {
          id: 's1',
          centerId: 'c1',
          ageBand: 'band_1_3',
          outcome: { score: 80 },
          followUpIn6Months: false,
        },
      ],
      count: async () => 0,
    },
    referral: {
      count: async () => {
        callCounts.referralCount += 1;
        return 2;
      },
      groupBy: async () => {
        callCounts.referralGroupBy += 1;
        return [{ centerId: 'c1', _count: { _all: 2 } }];
      },
      findMany: async () => [],
    },
    administrativeUnit: {
      findUnique: async () => null,
      findMany: async () => [],
    },
    $queryRaw: async () => {
      callCounts.nutritionQueryRaw += 1;
      return [
        { centerId: 'c1', nutritionStatus: 'severe', cnt: 2 },
        { centerId: 'c1', nutritionStatus: 'normal', cnt: 8 },
      ];
    },
  };
}

async function main() {
  const prisma = stubPrisma();
  const service = new MonitoringService(prisma as never);
  const actor = user({
    role: UserRole.district_focal_person,
    districtId: 'd1',
  });

  await assert('attendance monitoring returns summary + pagination', async () => {
    const result = await service.attendance(actor, {
      from: new Date('2026-08-01'),
      to: new Date('2026-08-05'),
      page: 1,
      pageSize: 20,
    });
    eq(result.summary.enrolledChildren, 10);
    eq(
      typeof result.summary.attendanceRate === 'number' || result.summary.attendanceRate === null,
      true,
    );
    eq(Array.isArray(result.items), true);
    eq(result.page, 1);
  });

  await assert('nutrition monitoring includes severe counts', async () => {
    const result = await service.nutrition(actor, {});
    eq(result.summary.severe, 2);
    eq(result.summary.normal, 8);
    eq(result.summary.screenings, 10);
  });

  await assert('feeding monitoring returns coverage fields', async () => {
    const result = await service.feeding(actor, {
      from: new Date('2026-08-01'),
      to: new Date('2026-08-03'),
    });
    eq(result.summary.daysRecorded, 3);
    eq('feedingCoverage' in result.summary, true);
  });

  await assert('sted monitoring extracts average score', async () => {
    const result = await service.sted(actor, {});
    eq(result.summary.assessmentsCompleted, 1);
    eq(result.summary.averageScore, 80);
  });

  await assert('referrals monitoring returns overdue + pending', async () => {
    const result = await service.referrals(actor, {});
    eq(result.summary.pending, 2);
    eq('averageCompletionDays' in result.summary, true);
  });

  await assert('attendance monitoring query count is O(1) w.r.t. center cardinality', async () => {
    const prisma = stubPrisma();
    const svc = new MonitoringService(prisma as never);
    const ncda = user({ role: UserRole.ncda_admin });
    await svc.attendance(ncda, {
      from: new Date('2026-08-01'),
      to: new Date('2026-08-05'),
      page: 1,
      pageSize: 20,
    });
    // Previously: 3 counts × N centers. Must stay bounded (not scale with 50 centers).
    if (prisma.callCounts.attendanceCount > 10) {
      throw new Error(`attendance count fan-out too high: ${prisma.callCounts.attendanceCount}`);
    }
    if (prisma.callCounts.attendanceGroupBy < 1) {
      throw new Error('expected attendance groupBy aggregation');
    }
    if (prisma.callCounts.childGroupBy < 1) {
      throw new Error('expected child groupBy for enrolled-by-center');
    }
    eq(prisma.callCounts.centersFindMany, 1);
  });

  await assert('feeding/referrals/nutrition use aggregations not per-center counts', async () => {
    const prisma = stubPrisma();
    const svc = new MonitoringService(prisma as never);
    const ncda = user({ role: UserRole.ncda_admin });
    await svc.feeding(ncda, {
      from: new Date('2026-08-01'),
      to: new Date('2026-08-03'),
    });
    await svc.referrals(ncda, {});
    await svc.nutrition(ncda, {});
    if (prisma.callCounts.feedingGroupBy < 1) {
      throw new Error('expected feeding groupBy');
    }
    if (prisma.callCounts.referralGroupBy < 1) {
      throw new Error('expected referral groupBy');
    }
    if (prisma.callCounts.nutritionQueryRaw < 1) {
      throw new Error('expected nutrition $queryRaw aggregation');
    }
  });

  console.log('\nAll monitoring tests passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

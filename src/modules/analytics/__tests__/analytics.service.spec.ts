/**
 * Analytics dashboard tests.
 * Run: npx ts-node src/modules/analytics/__tests__/analytics.service.spec.ts
 */
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
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
}) {
  let childIdx = 0;
  let attIdx = 0;
  let refIdx = 0;
  let feedIdx = 0;
  let distinctCalls = 0;

  return {
    ecdCenter: {
      count: async () => counts.centers?.length ?? 2,
      findMany: async () =>
        (counts.centers ?? ['c1', 'c2']).map((id) => ({ id })),
      findFirst: async ({ where }: { where: { id: string } }) => ({
        id: where.id,
        districtId: 'd1',
      }),
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
      // Alternating attendance then feeding distinct-center counts
      const list =
        distinctCalls === 0
          ? counts.attendanceCenters ?? ['c1']
          : counts.feedingCenters ?? ['c1'];
      distinctCalls += 1;
      return [{ cnt: list.length }];
    },
  };
}

async function main() {
  await assert('dashboard aggregates metrics for district', async () => {
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
  });

  await assert('caregiver cannot query another center', async () => {
    const service = new AnalyticsService(createPrisma({}) as never);
    let threw = false;
    try {
      await service.getDashboard(
        user({ role: UserRole.caregiver, centerId: 'c1' }),
        { centerId: 'c2' },
      );
    } catch (e) {
      threw = e instanceof ForbiddenException;
    }
    eq(threw, true);
  });

  await assert('rejects inverted date range', async () => {
    const service = new AnalyticsService(createPrisma({ centers: ['c1'] }) as never);
    let threw = false;
    try {
      await service.getDashboard(
        user({ role: UserRole.ncda_admin }),
        {
          from: new Date('2026-08-10'),
          to: new Date('2026-08-01'),
        },
      );
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

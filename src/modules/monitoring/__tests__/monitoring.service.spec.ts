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
  return {
    ecdCenter: {
      findMany: async () => [{ id: 'c1', name: 'Center 1' }],
      findFirst: async () => ({ id: 'c1', districtId: 'd1', villageId: 'v1' }),
      count: async () => 1,
    },
    child: {
      count: async () => 10,
      findMany: async () => [],
    },
    attendanceRecord: {
      count: async () => 5,
      groupBy: async () => [],
    },
    childNutritionScreening: {
      groupBy: async () => [
        { nutritionStatus: 'severe', _count: { _all: 2 } },
        { nutritionStatus: 'normal', _count: { _all: 8 } },
      ],
      count: async () => 1,
    },
    centerFeedingDay: {
      count: async () => 3,
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
      count: async () => 2,
      findMany: async () => [],
    },
    administrativeUnit: {
      findUnique: async () => null,
      findMany: async () => [],
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
    eq(typeof result.summary.attendanceRate === 'number' || result.summary.attendanceRate === null, true);
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

  console.log('\nAll monitoring tests passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

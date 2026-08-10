/**
 * Reports service tests.
 * Run: npx ts-node src/modules/reports/__tests__/reports.service.spec.ts
 */
import { UserRole } from '@prisma/client';
import { AuthUser } from '../../auth/interfaces/jwt-payload.interface';
import { ReportsService } from '../reports.service';

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
  let childCountCall = 0;
  return {
    ecdCenter: {
      findMany: async () => [
        { id: 'c1', name: 'C1', code: 'C1', status: 'active' },
      ],
      findFirst: async () => ({ id: 'c1', districtId: 'd1', villageId: 'v1' }),
      count: async () => 1,
    },
    child: {
      count: async () => {
        const values = [100, 80, 10, 10, 5, 3, 2];
        const v = values[childCountCall] ?? 0;
        childCountCall += 1;
        return v;
      },
      findMany: async () => [
        {
          id: 'ch1',
          firstName: 'Ada',
          lastName: 'L',
          centerId: 'c1',
          archivedAt: new Date('2026-08-02'),
          archiveReason: 'moved',
          center: { name: 'C1' },
          registeredAt: new Date('2026-08-01'),
        },
      ],
    },
    childTransfer: {
      count: async () => 2,
    },
    attendanceRecord: { count: async () => 4 },
    childNutritionScreening: { count: async () => 1 },
    centerFeedingDay: { count: async () => 2 },
    referral: { count: async () => 1 },
    stedAssessment: { count: async () => 1 },
    administrativeUnit: {
      findUnique: async () => null,
      findMany: async () => [],
    },
  };
}

async function main() {
  const actor = user({
    role: UserRole.district_focal_person,
    districtId: 'd1',
  });

  await assert('enrollment report returns status breakdown', async () => {
    const result = await new ReportsService(stubPrisma() as never).enrollment(
      actor,
      { from: new Date('2026-08-01'), to: new Date('2026-08-31') },
    );
    eq(result.summary.totalEnrolled, 100);
    eq(result.summary.active, 80);
    eq(Array.isArray(result.trend), true);
  });

  await assert('dropouts documents archived interpretation', async () => {
    const result = await new ReportsService(stubPrisma() as never).dropouts(
      actor,
      { from: new Date('2026-08-01'), to: new Date('2026-08-31') },
    );
    eq(
      result.interpretation.dropoutDefinition.includes('archived'),
      true,
    );
    eq(result.summary.dropouts >= 0, true);
    eq(result.summary.transfersOut, 2);
  });

  await assert('centers report includes performance blocks', async () => {
    const result = await new ReportsService(stubPrisma() as never).centers(
      actor,
      {},
    );
    eq(result.items.length, 1);
    eq('attendance' in result.items[0], true);
    eq('nutrition' in result.items[0], true);
    eq('sted' in result.items[0], true);
  });

  await assert('district report returns KPIs', async () => {
    const result = await new ReportsService(stubPrisma() as never).district(
      actor,
      {},
    );
    eq('activeChildren' in result.kpis, true);
    eq('attendanceRate' in result.kpis, true);
    eq(result.districtId, 'd1');
  });

  console.log('\nAll reports tests passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

/**
 * Children demographics drill-down tests.
 * Run: npx ts-node src/modules/analytics/__tests__/children-demographics.service.spec.ts
 */
import { UserRole } from '../../../common/domain';
import { ForbiddenException } from '@nestjs/common';
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

function createPrisma(opts?: {
  centers?: string[];
  demoRows?: Array<{
    ageBand: string;
    gender: string;
    hasDisability: boolean;
    cnt: number;
  }>;
  staffRows?: Array<{
    role: string;
    gender: string | null;
    educationLevel: string | null;
    cnt: number;
  }>;
  certifiedCnt?: number;
  byDistrict?: Array<{
    districtId: string;
    districtName: string;
    districtCode: string;
    boys: number;
    girls: number;
    total: number;
  }>;
}) {
  const centers = opts?.centers ?? ['c1', 'c2'];
  let queryCall = 0;

  return {
    ecdCenter: {
      count: async () => centers.length,
      findMany: async () => centers.map((id) => ({ id })),
      findFirst: async ({ where }: { where: { id: string } }) => ({
        id: where.id,
        districtId: 'd1',
      }),
    },
    $queryRaw: async () => {
      const call = queryCall;
      queryCall += 1;
      if (call === 0) {
        return (
          opts?.demoRows ?? [
            { ageBand: 'age_0_2', gender: 'male', hasDisability: false, cnt: 10 },
            { ageBand: 'age_0_2', gender: 'female', hasDisability: true, cnt: 2 },
            { ageBand: 'age_3_6', gender: 'male', hasDisability: true, cnt: 5 },
            { ageBand: 'age_3_6', gender: 'female', hasDisability: false, cnt: 20 },
            { ageBand: 'age_above_6', gender: 'male', hasDisability: false, cnt: 3 },
          ]
        );
      }
      if (call === 1) {
        return (
          opts?.staffRows ?? [
            {
              role: 'caregiver',
              gender: 'female',
              educationLevel: 'diploma',
              cnt: 4,
            },
            {
              role: 'caregiver',
              gender: 'male',
              educationLevel: 'bachelor',
              cnt: 2,
            },
            {
              role: 'ecd_director',
              gender: 'female',
              educationLevel: null,
              cnt: 1,
            },
          ]
        );
      }
      if (call === 2) {
        return [{ cnt: opts?.certifiedCnt ?? 3 }];
      }
      return (
        opts?.byDistrict ?? [
          {
            districtId: 'd1',
            districtName: 'Gasabo',
            districtCode: '01',
            boys: 18,
            girls: 22,
            total: 40,
          },
        ]
      );
    },
  };
}

async function main() {
  await assert('aggregates children age/gender/disability and staff rollups', async () => {
    const result = await new AnalyticsService(createPrisma() as never).getChildrenDemographics(
      user({ role: UserRole.district_focal_person, districtId: 'd1' }),
      {},
    );

    eq(result.children.total, 40);
    eq(result.children.boys, 18);
    eq(result.children.girls, 22);
    eq(result.children.withDisability, 7);
    eq(result.children.byAgeBand.age_0_2.total, 12);
    eq(result.children.byAgeBand.age_0_2.girlsWithDisability, 2);
    eq(result.children.byAgeBand.age_3_6.boysWithDisability, 5);
    eq(result.children.byAgeBand.age_above_6.boys, 3);

    eq(result.caregivers.total, 6);
    eq(result.caregivers.male, 2);
    eq(result.caregivers.female, 4);
    eq(result.caregivers.education.diploma, 4);
    eq(result.caregivers.education.degree, 2);
    eq(result.caregivers.education.withTrainingCertificate, 3);

    eq(result.supportingStaff.total, 1);
    eq(result.supportingStaff.female, 1);
    eq(result.childrenPerCaregiver, 6.7);
    eq(result.byDistrict.length, 1);
    eq(result.byDistrict[0].districtName, 'Gasabo');
    eq(result.districtId, 'd1');
    eq(result.centersInScope, 2);
  });

  await assert('empty district returns zeroed demographics', async () => {
    const prisma = createPrisma({ centers: [] });
    prisma.ecdCenter.findMany = async () => [];
    prisma.ecdCenter.count = async () => 0;

    const result = await new AnalyticsService(prisma as never).getChildrenDemographics(
      user({ role: UserRole.district_focal_person, districtId: 'empty' }),
      {},
    );

    eq(result.centersInScope, 0);
    eq(result.children.total, 0);
    eq(result.childrenPerCaregiver, null);
    eq(result.byDistrict, []);
  });

  await assert('caregiver cannot query another center', async () => {
    const service = new AnalyticsService(createPrisma() as never);
    let threw = false;
    try {
      await service.getChildrenDemographics(user({ role: UserRole.caregiver, centerId: 'c1' }), {
        centerId: 'c2',
      });
    } catch (e) {
      threw = e instanceof ForbiddenException;
    }
    eq(threw, true);
  });

  await assert('ratio is null when there are no caregivers', async () => {
    const result = await new AnalyticsService(
      createPrisma({
        staffRows: [],
        certifiedCnt: 0,
      }) as never,
    ).getChildrenDemographics(user({ role: UserRole.ncda_admin }), {});

    eq(result.caregivers.total, 0);
    eq(result.childrenPerCaregiver, null);
    eq(result.children.total, 40);
  });

  console.log('\nAll children-demographics tests passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

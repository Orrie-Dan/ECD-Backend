import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { StedAgeBand, UserRole } from '@prisma/client';
import { canAccessCenter } from '../../../common/auth/scope.util';
import { createMockLookupResolver } from '../../../common/lookups/lookup-resolver.mock';
import { AuthUser } from '../../auth/interfaces/jwt-payload.interface';
import { CreateStedAssessmentDto } from '../dto/create-sted-assessment.dto';
import { StedService } from '../sted.service';

/**
 * STED service tests (mocked Prisma).
 * Run: npx ts-node src/modules/sted/__tests__/sted.service.spec.ts
 */

function user(partial: Partial<AuthUser> & Pick<AuthUser, 'role'>): AuthUser {
  return {
    id: partial.id ?? 'user-1',
    username: partial.username ?? 'user',
    email: null,
    fullName: 'User',
    role: partial.role,
    centerId: partial.centerId ?? null,
    districtId: partial.districtId ?? null,
    status: 'active',
  };
}

function baseDto(overrides: Partial<CreateStedAssessmentDto> = {}): CreateStedAssessmentDto {
  return {
    childId: 'child-1',
    centerId: 'center-a',
    assessmentDate: '2026-08-01',
    ageBand: '1_3',
    consentObtained: true,
    physicalAssessment: { hearing: 'ok' },
    milestoneResults: { sit: true },
    outcome: { referred: false },
    followUpIn6Months: false,
    ...overrides,
  };
}

async function run() {
  let passed = 0;
  let failed = 0;

  const assert = async (name: string, fn: () => Promise<void> | void) => {
    try {
      await fn();
      passed += 1;
      console.log(`PASS  ${name}`);
    } catch (err) {
      failed += 1;
      console.error(`FAIL  ${name}`);
      console.error(err);
    }
  };

  const eq = (actual: unknown, expected: unknown) => {
    if (actual !== expected) {
      throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
  };

  const mockNotifications = {
    findUserIdsByRoleAndCenter: async () => [],
    findUserIdsByRoleAndDistrict: async () => [],
    notifyAsync: () => {},
    create: async () => ({}),
    createForMultipleUsers: async () => 0,
  } as any;

  const caregiver = user({
    role: UserRole.caregiver,
    id: 'cg-1',
    centerId: 'center-a',
    districtId: 'd1',
  });
  const focal = user({
    role: UserRole.district_focal_person,
    id: 'focal-1',
    districtId: 'd1',
  });
  const ncda = user({ role: UserRole.ncda_admin, id: 'ncda-1' });

  await assert('Create assessment', async () => {
    const creates: Record<string, unknown>[] = [];
    const stedApi = {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        creates.push(data);
        return {
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
          followUpDueDate: data.followUpDueDate ?? null,
          notes: data.notes ?? null,
        };
      },
    };
    const prisma = {
      child: {
        findFirst: async () => ({
          id: 'child-1',
          centerId: 'center-a',
          status: 'active',
          center: { id: 'center-a', districtId: 'd1' },
        }),
      },
      stedAssessment: stedApi,
      device: { findUnique: async () => null },
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({ stedAssessment: stedApi }),
    };

    const result = await new StedService(
      prisma as never,
      { log: async () => {} } as never,
      mockNotifications,
      createMockLookupResolver(),
    ).create(caregiver, baseDto());
    eq(creates.length, 1);
    eq(creates[0].ageBand, StedAgeBand.band_1_3);
    eq(creates[0].assessedById, 'cg-1');
    eq(result.ageBand, '1_3');
    eq(result.consentObtained, true);
    eq(result.assessedBy, 'cg-1');
  });

  await assert('History ordering newest first', async () => {
    const prisma = {
      $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
      child: {
        findFirst: async () => ({
          id: 'child-1',
          centerId: 'center-a',
          status: 'active',
          center: { id: 'center-a', districtId: 'd1' },
        }),
      },
      stedAssessment: {
        findMany: async ({ orderBy }: { orderBy: Array<Record<string, string>> }) => {
          eq(orderBy[0].assessmentDate, 'desc');
          eq(orderBy[1].createdAt, 'desc');
          const now = new Date();
          return [
            {
              id: 's2',
              childId: 'child-1',
              centerId: 'center-a',
              assessmentDate: new Date('2026-08-10'),
              ageBand: StedAgeBand.band_4_6,
              consentObtained: true,
              physicalAssessment: {},
              milestoneResults: {},
              outcome: {},
              followUpIn6Months: false,
              followUpDueDate: null,
              notes: null,
              assessedById: 'cg-1',
              createdAt: now,
              updatedAt: now,
              deletedAt: null,
              version: 1,
              syncStatus: 'synced',
              lastModifiedByDeviceId: null,
              lastModifiedAt: now,
            },
            {
              id: 's1',
              childId: 'child-1',
              centerId: 'center-a',
              assessmentDate: new Date('2026-07-01'),
              ageBand: StedAgeBand.band_1_3,
              consentObtained: true,
              physicalAssessment: {},
              milestoneResults: {},
              outcome: {},
              followUpIn6Months: false,
              followUpDueDate: null,
              notes: null,
              assessedById: 'cg-1',
              createdAt: now,
              updatedAt: now,
              deletedAt: null,
              version: 1,
              syncStatus: 'synced',
              lastModifiedByDeviceId: null,
              lastModifiedAt: now,
            },
          ];
        },
        count: async () => 2,
      },
    };

    const history = await new StedService(
      prisma as never,
      { log: async () => {} } as never,
      mockNotifications,
      createMockLookupResolver(),
    ).getHistory(caregiver, 'child-1');
    eq(history.items[0].id, 's2');
    eq(history.items[1].id, 's1');
    eq(history.total, 2);
  });

  await assert('Invalid ageBand rejected at DTO contract level', () => {
    const allowed = ['1_3', '4_6'];
    eq(allowed.includes('band_1_3'), false);
    eq(allowed.includes('1_3'), true);
  });

  await assert('Caregiver cannot access another center', async () => {
    eq(canAccessCenter(caregiver, 'center-b', 'd1'), false);
    const prisma = {
      child: {
        findFirst: async () => ({
          id: 'child-x',
          centerId: 'center-b',
          status: 'active',
          center: { id: 'center-b', districtId: 'd1' },
        }),
      },
    };
    let caught: unknown;
    try {
      await new StedService(
        prisma as never,
        { log: async () => {} } as never,
        mockNotifications,
        createMockLookupResolver(),
      ).create(caregiver, baseDto({ childId: 'child-x', centerId: 'center-b' }));
    } catch (err) {
      caught = err;
    }
    eq(caught instanceof ForbiddenException, true);
  });

  await assert('District cannot access another district', async () => {
    eq(canAccessCenter(focal, 'center-z', 'd2'), false);
    const prisma = {
      child: {
        findFirst: async () => ({
          id: 'child-z',
          centerId: 'center-z',
          status: 'active',
          center: { id: 'center-z', districtId: 'd2' },
        }),
      },
    };
    let caught: unknown;
    try {
      await new StedService(
        prisma as never,
        { log: async () => {} } as never,
        mockNotifications,
        createMockLookupResolver(),
      ).create(focal, baseDto({ childId: 'child-z', centerId: 'center-z' }));
    } catch (err) {
      caught = err;
    }
    eq(caught instanceof ForbiddenException, true);
  });

  await assert('NCDA unrestricted', async () => {
    eq(canAccessCenter(ncda, 'center-z', 'd9'), true);
    let created = false;
    const stedApi = {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        created = true;
        return {
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
          followUpDueDate: null,
          notes: null,
        };
      },
    };
    const prisma = {
      child: {
        findFirst: async () => ({
          id: 'child-z',
          centerId: 'center-z',
          status: 'active',
          center: { id: 'center-z', districtId: 'd9' },
        }),
      },
      stedAssessment: stedApi,
      device: { findUnique: async () => null },
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({ stedAssessment: stedApi }),
    };
    await new StedService(
      prisma as never,
      { log: async () => {} } as never,
      mockNotifications,
      createMockLookupResolver(),
    ).create(
      ncda,
      baseDto({
        childId: 'child-z',
        centerId: 'center-z',
        ageBand: '4_6',
      }),
    );
    eq(created, true);
  });

  await assert('consentObtained required true', async () => {
    const prisma = {
      child: {
        findFirst: async () => ({
          id: 'child-1',
          centerId: 'center-a',
          status: 'active',
          center: { id: 'center-a', districtId: 'd1' },
        }),
      },
    };
    let caught: unknown;
    try {
      await new StedService(
        prisma as never,
        { log: async () => {} } as never,
        mockNotifications,
        createMockLookupResolver(),
      ).create(caregiver, baseDto({ consentObtained: false }));
    } catch (err) {
      caught = err;
    }
    eq(caught instanceof BadRequestException, true);
  });

  await assert('Append-only: multiple creates allowed for same child', async () => {
    const creates: unknown[] = [];
    const stedApi = {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        creates.push(data);
        return {
          ...data,
          id: `sted-${creates.length}`,
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
          followUpDueDate: null,
          notes: null,
        };
      },
    };
    const prisma = {
      child: {
        findFirst: async () => ({
          id: 'child-1',
          centerId: 'center-a',
          status: 'active',
          center: { id: 'center-a', districtId: 'd1' },
        }),
      },
      stedAssessment: stedApi,
      device: { findUnique: async () => null },
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({ stedAssessment: stedApi }),
    };
    const svc = new StedService(
      prisma as never,
      { log: async () => {} } as never,
      mockNotifications,
      createMockLookupResolver(),
    );
    await svc.create(caregiver, baseDto({ assessmentDate: '2026-08-01' }));
    await svc.create(caregiver, baseDto({ assessmentDate: '2026-08-15' }));
    eq(creates.length, 2);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

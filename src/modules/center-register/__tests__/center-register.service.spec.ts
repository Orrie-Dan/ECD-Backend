/**
 * NCDA register (book sections VIII–XIV) service tests.
 * Run: npx ts-node src/modules/center-register/__tests__/center-register.service.spec.ts
 */
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  CenterSupportCategory,
  InKindItemType,
  ParentContributionType,
  UserRole,
} from '@prisma/client';
import { AuthUser } from '../../auth/interfaces/jwt-payload.interface';
import { createMockLookupResolver } from '../../../common/lookups/lookup-resolver.mock';
import { CenterRegisterAccessService } from '../center-register-access.service';
import { CenterSupportService } from '../center-support.service';
import { CenterVisitsService } from '../center-visits.service';
import { CommitteeMembersService } from '../committee-members.service';
import { ParentContributionsService } from '../parent-contributions.service';
import { ParentingSessionsService } from '../parenting-sessions.service';
import { StaffTrainingsService } from '../staff-trainings.service';

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
    username: partial.username ?? 'user',
    email: null,
    fullName: 'User',
    role: partial.role,
    centerId: partial.centerId ?? null,
    districtId: partial.districtId ?? null,
    status: 'active',
  };
}

const director = user({
  id: 'dir-1',
  role: UserRole.ecd_director,
  centerId: 'center-1',
  districtId: 'district-1',
});
const otherDirector = user({
  id: 'dir-2',
  role: UserRole.ecd_director,
  centerId: 'center-2',
  districtId: 'district-1',
});
const caregiver = user({
  id: 'cg-1',
  role: UserRole.caregiver,
  centerId: 'center-1',
  districtId: 'district-1',
});
const district = user({
  id: 'dist-1',
  role: UserRole.district_focal_person,
  districtId: 'district-1',
});
const otherDistrict = user({
  id: 'dist-2',
  role: UserRole.district_focal_person,
  districtId: 'district-2',
});
const ncda = user({ id: 'ncda-1', role: UserRole.ncda_admin });

const center = {
  id: 'center-1',
  name: 'Center One',
  districtId: 'district-1',
};

const center2 = {
  id: 'center-2',
  name: 'Center Two',
  districtId: 'district-1',
};

function contributionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pc-1',
    centerId: 'center-1',
    childId: null,
    contributorName: 'Mukamana Alice',
    contributorPhone: '0788000000',
    contributionDate: new Date('2026-03-15'),
    contributionType: ParentContributionType.cash,
    amount: 5000,
    itemType: null,
    quantity: null,
    unit: null,
    description: null,
    notes: null,
    recordedById: 'dir-1',
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    center,
    ...overrides,
  };
}

function sessionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ps-1',
    centerId: 'center-1',
    sessionDate: new Date('2026-03-10'),
    topic: 'Positive discipline',
    facilitatorName: 'Uwase Marie',
    facilitatorRole: 'CHW',
    facilitatorUserId: null,
    messageSummary: 'Respectful parenting',
    maleAttendees: 4,
    femaleAttendees: 12,
    notes: null,
    recordedById: 'dir-1',
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    center,
    ...overrides,
  };
}

async function expectForbidden(fn: () => Promise<unknown>): Promise<void> {
  let thrown = false;
  try {
    await fn();
  } catch (e) {
    thrown = e instanceof ForbiddenException;
  }
  eq(thrown, true);
}

const access = {
  requireCenter: async (id: string) => {
    if (id === 'center-1') return center;
    if (id === 'center-2') return center2;
    throw new Error('not found');
  },
  requireChildInCenter: async () => undefined,
} as unknown as CenterRegisterAccessService;

async function main() {
  // --- Director mutations (own centre) ---
  await assert('director can create contribution for own centre', async () => {
    const prisma = {
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          parentContribution: { create: async () => contributionRow() },
        }),
    };
    const service = new ParentContributionsService(
      prisma as never,
      { log: async () => undefined } as never,
      access,
      createMockLookupResolver(),
    );
    const result = await service.create(director, {
      centerId: 'center-1',
      contributorName: 'Mukamana Alice',
      contributionDate: '2026-03-15',
      contributionType: ParentContributionType.cash,
      amount: 5000,
    });
    eq(result.contributionType, ParentContributionType.cash);
  });

  await assert('director can update own-centre parenting session', async () => {
    const existing = sessionRow();
    const prisma = {
      parentingSession: {
        findFirst: async () => existing,
      },
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          parentingSession: {
            updateMany: async () => ({ count: 1 }),
            findUniqueOrThrow: async () => ({
              ...existing,
              topic: 'Updated topic',
              version: 2,
            }),
          },
        }),
    };
    const service = new ParentingSessionsService(
      prisma as never,
      { log: async () => undefined } as never,
      access,
    );
    const result = await service.update(director, 'ps-1', {
      version: 1,
      topic: 'Updated topic',
    });
    eq(result.topic, 'Updated topic');
  });

  await assert('director can add committee member', async () => {
    const prisma = {
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          ecdCommitteeMember: {
            create: async (args: { data: Record<string, unknown> }) => ({
              id: 'cm-1',
              ...args.data,
              endDate: null,
              version: 1,
              createdAt: new Date(),
              updatedAt: new Date(),
              center,
            }),
          },
        }),
    };
    const service = new CommitteeMembersService(
      prisma as never,
      { log: async () => undefined } as never,
      access,
    );
    const result = await service.create(director, {
      centerId: 'center-1',
      fullName: 'Niyonsenga Jean',
      position: 'President',
      phone: '0788',
    });
    eq(result.fullName, 'Niyonsenga Jean');
    eq(result.isActive, true);
  });

  await assert('director can deactivate committee member', async () => {
    const existing = {
      id: 'cm-1',
      centerId: 'center-1',
      userId: null,
      fullName: 'Niyonsenga Jean',
      position: 'President',
      phone: '0788',
      startDate: new Date('2026-01-01'),
      endDate: null,
      isActive: true,
      notes: null,
      recordedById: 'dir-1',
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      center,
    };
    const prisma = {
      ecdCommitteeMember: {
        findFirst: async () => existing,
        updateMany: async () => ({ count: 1 }),
        findUniqueOrThrow: async () => ({
          ...existing,
          isActive: false,
          endDate: new Date('2026-08-01'),
          version: 2,
        }),
      },
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
    };
    const service = new CommitteeMembersService(
      prisma as never,
      { log: async () => undefined } as never,
      access,
    );
    const result = await service.deactivate(director, 'cm-1', {
      version: 1,
      endDate: '2026-08-01',
    });
    eq(result.isActive, false);
  });

  await assert('director can create centre support', async () => {
    const prisma = {
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          centerSupport: {
            create: async (args: { data: Record<string, unknown> }) => ({
              id: 'cs-1',
              ...args.data,
              quantity: args.data.quantity ?? null,
              version: 1,
              createdAt: new Date(),
              updatedAt: new Date(),
              center,
            }),
          },
        }),
    };
    const service = new CenterSupportService(
      prisma as never,
      { log: async () => undefined } as never,
      access,
      createMockLookupResolver(),
    );
    const result = await service.create(director, {
      centerId: 'center-1',
      receivedDate: '2026-04-02',
      supportCategory: CenterSupportCategory.food,
      description: 'Maize flour',
      providerName: 'Sector',
    });
    eq(result.supportCategory, CenterSupportCategory.food);
  });

  await assert('director can create/update visitor', async () => {
    const prisma = {
      $transaction: async (arg: unknown) => {
        if (typeof arg === 'function') {
          return (arg as (tx: unknown) => Promise<unknown>)({
            centerVisit: {
              create: async (args: { data: Record<string, unknown> }) => ({
                id: 'cv-1',
                ...args.data,
                version: 1,
                createdAt: new Date(),
                updatedAt: new Date(),
                center,
              }),
              updateMany: async () => ({ count: 1 }),
              findUniqueOrThrow: async () => ({
                id: 'cv-1',
                centerId: 'center-1',
                visitDate: new Date('2026-05-20'),
                visitorName: 'Updated visitor',
                occupationOrRole: 'District officer',
                purposeOrMessage: 'Supportive supervision',
                notes: null,
                hostedById: null,
                recordedById: 'dir-1',
                version: 2,
                createdAt: new Date(),
                updatedAt: new Date(),
                center,
              }),
            },
          });
        }
        return Promise.all(arg as Promise<unknown>[]);
      },
      centerVisit: {
        findFirst: async () => ({
          id: 'cv-1',
          centerId: 'center-1',
          visitDate: new Date('2026-05-20'),
          visitorName: 'Kalisa Patrick',
          occupationOrRole: 'District officer',
          purposeOrMessage: 'Supportive supervision',
          notes: null,
          hostedById: null,
          recordedById: 'dir-1',
          version: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
          center,
        }),
      },
    };
    const service = new CenterVisitsService(
      prisma as never,
      { log: async () => undefined } as never,
      access,
    );
    const created = await service.create(director, {
      centerId: 'center-1',
      visitDate: '2026-05-20',
      visitorName: 'Kalisa Patrick',
      occupationOrRole: 'District officer',
      purposeOrMessage: 'Supportive supervision',
    });
    eq(created.visitorName, 'Kalisa Patrick');
    const updated = await service.update(director, 'cv-1', {
      version: 1,
      visitorName: 'Updated visitor',
    });
    eq(updated.visitorName, 'Updated visitor');
  });

  await assert('director can create staff training', async () => {
    const prisma = {
      userAccount: {
        findFirst: async () => ({ id: 'cg-1', centerId: 'center-1' }),
      },
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          staffTraining: {
            create: async (args: { data: Record<string, unknown> }) => ({
              id: 'st-1',
              ...args.data,
              version: 1,
              createdAt: new Date(),
              updatedAt: new Date(),
              center,
            }),
          },
        }),
    };
    const service = new StaffTrainingsService(
      prisma as never,
      { log: async () => undefined } as never,
      access,
    );
    const result = await service.create(director, {
      centerId: 'center-1',
      traineeUserId: 'cg-1',
      traineeName: 'Uwimana Claire',
      traineeRole: 'Caregiver',
      trainingDate: '2026-02-10',
      trainingProvider: 'NCDA',
      topic: 'Early stimulation',
      durationDays: 3,
      certificateReceived: true,
    });
    eq(result.durationDays, 3);
  });

  // --- Cross-centre / IDOR ---
  await assert('director of Center A cannot mutate Center B contribution via payload', async () => {
    const service = new ParentContributionsService(
      {} as never,
      { log: async () => undefined } as never,
      access,
      createMockLookupResolver(),
    );
    await expectForbidden(() =>
      service.create(director, {
        centerId: 'center-2',
        contributorName: 'X',
        contributionDate: '2026-03-15',
        contributionType: ParentContributionType.cash,
        amount: 100,
      }),
    );
  });

  await assert('director of Center A cannot update Center B record by id', async () => {
    const prisma = {
      parentContribution: {
        findFirst: async () => contributionRow({ centerId: 'center-2', center: center2 }),
      },
    };
    const service = new ParentContributionsService(
      prisma as never,
      { log: async () => undefined } as never,
      access,
      createMockLookupResolver(),
    );
    await expectForbidden(() =>
      service.update(director, 'pc-1', {
        version: 1,
        contributorName: 'Hacked',
      }),
    );
  });

  await assert('list rejects centerId query bypass for center staff', async () => {
    const service = new ParentContributionsService(
      {} as never,
      { log: async () => undefined } as never,
      access,
      createMockLookupResolver(),
    );
    await expectForbidden(() => service.list(caregiver, { centerId: 'center-2' }));
  });

  // --- Caregiver read-only on register admin records ---
  await assert('caregiver cannot create contribution', async () => {
    const service = new ParentContributionsService(
      {} as never,
      { log: async () => undefined } as never,
      access,
      createMockLookupResolver(),
    );
    await expectForbidden(() =>
      service.create(caregiver, {
        centerId: 'center-1',
        contributorName: 'X',
        contributionDate: '2026-03-15',
        contributionType: ParentContributionType.cash,
        amount: 100,
      }),
    );
  });

  await assert('caregiver cannot update contribution', async () => {
    const prisma = {
      parentContribution: { findFirst: async () => contributionRow() },
    };
    const service = new ParentContributionsService(
      prisma as never,
      { log: async () => undefined } as never,
      access,
      createMockLookupResolver(),
    );
    await expectForbidden(() =>
      service.update(caregiver, 'pc-1', { version: 1, contributorName: 'X' }),
    );
  });

  await assert('caregiver cannot access contribution summary', async () => {
    const service = new ParentContributionsService(
      {} as never,
      { log: async () => undefined } as never,
      access,
      createMockLookupResolver(),
    );
    await expectForbidden(() => service.summary(caregiver, { centerId: 'center-1' }));
  });

  await assert('caregiver cannot create/change parenting session', async () => {
    const service = new ParentingSessionsService(
      {} as never,
      { log: async () => undefined } as never,
      access,
    );
    await expectForbidden(() =>
      service.create(caregiver, {
        centerId: 'center-1',
        sessionDate: '2026-03-10',
        topic: 'T',
        facilitatorName: 'F',
        messageSummary: 'M',
        maleAttendees: 1,
        femaleAttendees: 1,
      }),
    );
    const prisma = {
      parentingSession: { findFirst: async () => sessionRow() },
    };
    const updateService = new ParentingSessionsService(
      prisma as never,
      { log: async () => undefined } as never,
      access,
    );
    await expectForbidden(() =>
      updateService.update(caregiver, 'ps-1', { version: 1, topic: 'Hack' }),
    );
  });

  await assert('caregiver cannot manage committee', async () => {
    const service = new CommitteeMembersService(
      {} as never,
      { log: async () => undefined } as never,
      access,
    );
    await expectForbidden(() =>
      service.create(caregiver, {
        centerId: 'center-1',
        fullName: 'X',
        position: 'President',
      }),
    );
    const prisma = {
      ecdCommitteeMember: {
        findFirst: async () => ({
          id: 'cm-1',
          centerId: 'center-1',
          fullName: 'X',
          position: 'President',
          phone: null,
          userId: null,
          startDate: new Date(),
          endDate: null,
          isActive: true,
          notes: null,
          recordedById: 'dir-1',
          version: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
          center,
        }),
      },
    };
    const updateService = new CommitteeMembersService(
      prisma as never,
      { log: async () => undefined } as never,
      access,
    );
    await expectForbidden(() =>
      updateService.deactivate(caregiver, 'cm-1', { version: 1, endDate: '2026-08-01' }),
    );
  });

  await assert('caregiver cannot modify centre support', async () => {
    const service = new CenterSupportService(
      {} as never,
      { log: async () => undefined } as never,
      access,
      createMockLookupResolver(),
    );
    await expectForbidden(() =>
      service.create(caregiver, {
        centerId: 'center-1',
        receivedDate: '2026-04-02',
        supportCategory: CenterSupportCategory.food,
        description: 'X',
        providerName: 'Y',
      }),
    );
  });

  await assert('caregiver cannot create/change staff training', async () => {
    const service = new StaffTrainingsService(
      {} as never,
      { log: async () => undefined } as never,
      access,
    );
    await expectForbidden(() =>
      service.create(caregiver, {
        centerId: 'center-1',
        traineeName: 'Self',
        traineeRole: 'Caregiver',
        trainingDate: '2026-02-10',
        trainingProvider: 'NCDA',
        topic: 'T',
        durationDays: 1,
        certificateReceived: false,
      }),
    );
  });

  await assert('caregiver list scoped to own centre', async () => {
    const captured: { where?: Record<string, unknown> } = {};
    const prisma = {
      $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
      parentContribution: {
        findMany: async (args: { where: Record<string, unknown> }) => {
          captured.where = args.where;
          return [contributionRow()];
        },
        count: async () => 1,
      },
    };
    const service = new ParentContributionsService(
      prisma as never,
      { log: async () => undefined } as never,
      access,
      createMockLookupResolver(),
    );
    await service.list(caregiver, {});
    eq(captured.where!.centerId, 'center-1');
  });

  await assert('caregiver staff training list scoped to own history', async () => {
    const captured: { where?: Record<string, unknown> } = {};
    const prisma = {
      $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
      staffTraining: {
        findMany: async (args: { where: Record<string, unknown> }) => {
          captured.where = args.where;
          return [];
        },
        count: async () => 0,
      },
    };
    const service = new StaffTrainingsService(
      prisma as never,
      { log: async () => undefined } as never,
      access,
    );
    await service.list(caregiver, {});
    eq(captured.where!.centerId, 'center-1');
    eq(captured.where!.traineeUserId, 'cg-1');
  });

  await assert('caregiver cannot read another staff training by id', async () => {
    const prisma = {
      staffTraining: {
        findFirst: async () => ({
          id: 'st-1',
          centerId: 'center-1',
          traineeUserId: 'other-user',
          traineeName: 'Other',
          traineeRole: 'Caregiver',
          trainingDate: new Date(),
          trainingProvider: 'NCDA',
          topic: 'T',
          durationDays: 1,
          certificateReceived: false,
          notes: null,
          recordedById: 'dir-1',
          version: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
          center,
        }),
      },
    };
    const service = new StaffTrainingsService(
      prisma as never,
      { log: async () => undefined } as never,
      access,
    );
    await expectForbidden(() => service.get(caregiver, 'st-1'));
  });

  // --- District ---
  await assert('district can read register records in own district', async () => {
    const captured: { where?: Record<string, unknown> } = {};
    const prisma = {
      $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
      parentContribution: {
        findMany: async (args: { where: Record<string, unknown> }) => {
          captured.where = args.where;
          return [];
        },
        count: async () => 0,
      },
    };
    const service = new ParentContributionsService(
      prisma as never,
      { log: async () => undefined } as never,
      access,
      createMockLookupResolver(),
    );
    await service.list(district, {});
    eq((captured.where!.center as { districtId: string }).districtId, 'district-1');
  });

  await assert('district cannot mutate register records', async () => {
    const service = new ParentContributionsService(
      {} as never,
      { log: async () => undefined } as never,
      access,
      createMockLookupResolver(),
    );
    await expectForbidden(() =>
      service.create(district, {
        centerId: 'center-1',
        contributorName: 'X',
        contributionDate: '2026-03-15',
        contributionType: ParentContributionType.cash,
        amount: 10,
      }),
    );
  });

  await assert('district cannot read outside district via districtId query', async () => {
    const service = new ParentContributionsService(
      {} as never,
      { log: async () => undefined } as never,
      access,
      createMockLookupResolver(),
    );
    await expectForbidden(() => service.list(district, { districtId: 'district-2' }));
  });

  // --- NCDA ---
  await assert('NCDA can read register records nationally', async () => {
    const captured: { where?: Record<string, unknown> } = {};
    const prisma = {
      $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
      parentingSession: {
        findMany: async (args: { where: Record<string, unknown> }) => {
          captured.where = args.where;
          return [];
        },
        count: async () => 0,
      },
    };
    const service = new ParentingSessionsService(
      prisma as never,
      { log: async () => undefined } as never,
      access,
    );
    await service.list(ncda, { districtId: 'district-1' });
    eq((captured.where!.center as { districtId: string }).districtId, 'district-1');
  });

  await assert('NCDA cannot mutate register records', async () => {
    const service = new CenterVisitsService(
      {} as never,
      { log: async () => undefined } as never,
      access,
    );
    await expectForbidden(() =>
      service.create(ncda, {
        centerId: 'center-1',
        visitDate: '2026-05-20',
        visitorName: 'X',
        occupationOrRole: 'Y',
        purposeOrMessage: 'Z',
      }),
    );
  });

  await assert('NCDA can read contribution summary', async () => {
    const prisma = {
      parentContribution: {
        findMany: async () => [
          contributionRow({ contributorName: 'A', amount: 1000 }),
          contributionRow({
            id: 'pc-2',
            contributorName: 'B',
            contributionType: ParentContributionType.in_kind,
            amount: null,
            itemType: InKindItemType.milk,
          }),
        ],
      },
    };
    const service = new ParentContributionsService(
      prisma as never,
      { log: async () => undefined } as never,
      access,
      createMockLookupResolver(),
    );
    const summary = await service.summary(ncda, { centerId: 'center-1' });
    eq(summary.cashContributorCount, 1);
    eq(summary.inKindContributorCount, 1);
  });

  // --- Validation (director) ---
  await assert('negative cash amount rejected', async () => {
    const service = new ParentContributionsService(
      { $transaction: async () => undefined } as never,
      { log: async () => undefined } as never,
      access,
      createMockLookupResolver(),
    );
    let thrown = false;
    try {
      await service.create(director, {
        centerId: 'center-1',
        contributorName: 'X',
        contributionDate: '2026-03-15',
        contributionType: ParentContributionType.cash,
        amount: -1,
      });
    } catch (e) {
      thrown = e instanceof BadRequestException;
    }
    eq(thrown, true);
  });

  await assert('other director cannot mutate Center A records', async () => {
    const service = new ParentContributionsService(
      {} as never,
      { log: async () => undefined } as never,
      access,
      createMockLookupResolver(),
    );
    await expectForbidden(() =>
      service.create(otherDirector, {
        centerId: 'center-1',
        contributorName: 'X',
        contributionDate: '2026-03-15',
        contributionType: ParentContributionType.cash,
        amount: 100,
      }),
    );
  });

  console.log('All center-register tests passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

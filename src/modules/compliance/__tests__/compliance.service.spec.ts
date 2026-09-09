/**
 * Compliance module tests.
 * Run: npx ts-node src/modules/compliance/__tests__/compliance.service.spec.ts
 */
import { AssessmentStatus, AssessmentType, UserRole } from '../../../common/domain';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { OptimisticLockConflictException } from '../../../common/concurrency/optimistic-lock.exception';
import { AuthUser } from '../../auth/interfaces/jwt-payload.interface';
import { ComplianceService } from '../compliance.service';

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

function assessmentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'assessment-1',
    centerId: 'center-1',
    standardsVersion: '2024',
    assessmentType: AssessmentType.self_assessment,
    assessmentDate: new Date('2026-01-15'),
    status: AssessmentStatus.draft,
    submittedById: null,
    submittedAt: null,
    verifiedById: null,
    verifiedAt: null,
    overallClassification: null,
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    syncStatus: 'synced',
    lastModifiedAt: new Date(),
    lastModifiedByDeviceId: null,
    center: { id: 'center-1', name: 'Center One', districtId: 'district-1' },
    ...overrides,
  };
}

async function main() {
  await assert('list: caregiver sees own center only', async () => {
    const captured: { where?: Record<string, unknown> } = {};
    const prisma = {
      $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
      complianceAssessment: {
        findMany: async (args: { where: Record<string, unknown> }) => {
          captured.where = args.where;
          return [assessmentRow()];
        },
        count: async () => 1,
      },
    };
    const audit = { log: async () => undefined };
    const mockNotificationEvents = {
      onComplianceAssessmentStatusChanged: async () => {},
    } as never;
    const service = new ComplianceService(prisma as never, audit as never, mockNotificationEvents);

    const result = await service.listAssessments(
      user({ role: UserRole.caregiver, centerId: 'center-1' }),
      {},
    );

    eq(result.total, 1);
    eq(captured.where!.centerId, 'center-1');
  });

  await assert('list: district focal sees own district', async () => {
    const captured: { where?: Record<string, unknown> } = {};
    const prisma = {
      $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
      complianceAssessment: {
        findMany: async (args: { where: Record<string, unknown> }) => {
          captured.where = args.where;
          return [];
        },
        count: async () => 0,
      },
    };
    const mockNotificationEvents = {
      onComplianceAssessmentStatusChanged: async () => {},
    } as never;
    const service = new ComplianceService(
      prisma as never,
      { log: async () => undefined } as never,
      mockNotificationEvents,
    );

    await service.listAssessments(
      user({ role: UserRole.district_focal_person, districtId: 'district-1' }),
      {},
    );

    eq((captured.where!.center as { districtId: string }).districtId, 'district-1');
  });

  await assert('create: creates draft assessment with audit', async () => {
    const auditLogs: unknown[] = [];
    const prisma = {
      ecdCenter: {
        findFirst: async () => ({
          id: 'center-1',
          name: 'Center One',
          districtId: 'district-1',
        }),
      },
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          complianceAssessment: {
            create: async () => assessmentRow(),
          },
        };
        return fn(tx);
      },
    };
    const audit = {
      log: async (args: unknown) => {
        auditLogs.push(args);
      },
    };
    const mockNotificationEvents = {
      onComplianceAssessmentStatusChanged: async () => {},
    } as never;
    const service = new ComplianceService(prisma as never, audit as never, mockNotificationEvents);

    const result = await service.createAssessment(user({ role: UserRole.ncda_admin }), {
      centerId: 'center-1',
      standardsVersion: '2024',
      assessmentType: AssessmentType.self_assessment,
      assessmentDate: '2026-01-15',
    });

    eq(result.status, AssessmentStatus.draft);
    eq(auditLogs.length >= 1, true);
  });

  await assert('update: status transition draft→submitted allowed', async () => {
    const prisma = {
      complianceAssessment: {
        findFirst: async () => assessmentRow(),
        updateMany: async () => ({ count: 1 }),
        findUniqueOrThrow: async () =>
          assessmentRow({ status: AssessmentStatus.submitted, version: 2 }),
      },
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = { complianceAssessment: prisma.complianceAssessment };
        return fn(tx);
      },
    };
    const mockNotificationEvents = {
      onComplianceAssessmentStatusChanged: async () => {},
    } as never;
    const service = new ComplianceService(
      prisma as never,
      { log: async () => undefined } as never,
      mockNotificationEvents,
    );

    const result = await service.updateAssessment(
      user({ role: UserRole.district_focal_person, districtId: 'district-1' }),
      'assessment-1',
      { version: 1, status: AssessmentStatus.submitted },
    );

    eq(result.status, AssessmentStatus.submitted);
  });

  await assert('update: invalid status transition rejected', async () => {
    const prisma = {
      complianceAssessment: {
        findFirst: async () => assessmentRow({ status: AssessmentStatus.verified }),
      },
    };
    const mockNotificationEvents = {
      onComplianceAssessmentStatusChanged: async () => {},
    } as never;
    const service = new ComplianceService(
      prisma as never,
      { log: async () => undefined } as never,
      mockNotificationEvents,
    );

    let threw = false;
    try {
      await service.updateAssessment(user({ role: UserRole.ncda_admin }), 'assessment-1', {
        version: 1,
        status: AssessmentStatus.draft,
      });
    } catch (e) {
      threw = e instanceof BadRequestException;
    }
    eq(threw, true);
  });

  await assert('update: CAS conflict when version mismatches', async () => {
    const prisma = {
      complianceAssessment: {
        findFirst: async ({ select }: { select?: { version: boolean } }) => {
          if (select?.version) return { version: 2 };
          return assessmentRow({ version: 2 });
        },
        updateMany: async () => ({ count: 0 }),
      },
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = { complianceAssessment: prisma.complianceAssessment };
        return fn(tx);
      },
    };
    const mockNotificationEvents = {
      onComplianceAssessmentStatusChanged: async () => {},
    } as never;
    const service = new ComplianceService(
      prisma as never,
      { log: async () => undefined } as never,
      mockNotificationEvents,
    );

    let threw = false;
    try {
      await service.updateAssessment(user({ role: UserRole.ncda_admin }), 'assessment-1', {
        version: 1,
        status: AssessmentStatus.submitted,
      });
    } catch (e) {
      threw = e instanceof OptimisticLockConflictException;
    }
    eq(threw, true);
  });

  await assert('getAssessment: forbidden outside center scope', async () => {
    const prisma = {
      complianceAssessment: {
        findFirst: async () =>
          assessmentRow({
            center: { id: 'center-x', name: 'Other', districtId: 'other-district' },
          }),
      },
    };
    const mockNotificationEvents = {
      onComplianceAssessmentStatusChanged: async () => {},
    } as never;
    const service = new ComplianceService(
      prisma as never,
      { log: async () => undefined } as never,
      mockNotificationEvents,
    );

    let threw = false;
    try {
      await service.getAssessment(
        user({ role: UserRole.district_focal_person, districtId: 'district-1' }),
        'assessment-1',
      );
    } catch (e) {
      threw = e instanceof ForbiddenException;
    }
    eq(threw, true);
  });

  await assert('submitSelfEvaluation: director persists percent and rank', async () => {
    const created: Record<string, unknown>[] = [];
    const items: Record<string, unknown>[] = [];
    const centerUpdates: Record<string, unknown>[] = [];
    const prisma = {
      ecdCenter: {
        findFirst: async () => ({
          id: 'center-1',
          name: 'Center One',
          districtId: 'district-1',
        }),
      },
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          ecdStandard: {
            findUnique: async () => ({ id: 'std-score' }),
            create: async () => ({ id: 'std-score' }),
          },
          complianceAssessment: {
            create: async ({ data }: { data: Record<string, unknown> }) => {
              created.push(data);
              return {
                ...assessmentRow({
                  ...data,
                  id: 'assessment-new',
                  overallPercent: data.overallPercent,
                  overallRank: data.overallRank,
                }),
              };
            },
          },
          complianceAssessmentItem: {
            create: async ({ data }: { data: Record<string, unknown> }) => {
              items.push(data);
              return data;
            },
          },
          ecdCenter: {
            update: async ({ data }: { data: Record<string, unknown> }) => {
              centerUpdates.push(data);
              return data;
            },
          },
        };
        return fn(tx);
      },
    };
    const notified: unknown[] = [];
    const service = new ComplianceService(
      prisma as never,
      { log: async () => undefined } as never,
      {
        onComplianceAssessmentStatusChanged: async (payload: unknown) => {
          notified.push(payload);
        },
      } as never,
    );

    const result = await service.submitSelfEvaluation(
      user({ role: UserRole.ecd_director, centerId: 'center-1' }),
      {
        centerId: 'center-1',
        facilityTypeId: 'daycare',
        standardsVersion: '2024.1',
        assessmentDate: '2026-09-08',
        earnedScore: 168,
        maxScore: 199,
        percent: 84,
        rank: 'blue',
      },
    );

    eq(result.overallRank, 'blue');
    eq(result.overallPercent, 84);
    eq(created[0]?.overallRank, 'blue');
    eq(items.length, 1);
    eq(centerUpdates.length, 1);
    eq(notified.length, 1);
  });

  await assert('submitSelfEvaluation: rejects mismatched percent', async () => {
    const prisma = {
      ecdCenter: {
        findFirst: async () => ({
          id: 'center-1',
          name: 'Center One',
          districtId: 'district-1',
        }),
      },
    };
    const service = new ComplianceService(
      prisma as never,
      { log: async () => undefined } as never,
      { onComplianceAssessmentStatusChanged: async () => {} } as never,
    );

    let threw = false;
    try {
      await service.submitSelfEvaluation(
        user({ role: UserRole.ecd_director, centerId: 'center-1' }),
        {
          centerId: 'center-1',
          facilityTypeId: 'daycare',
          standardsVersion: '2024.1',
          assessmentDate: '2026-09-08',
          earnedScore: 100,
          maxScore: 199,
          percent: 99,
          rank: 'green',
        },
      );
    } catch (e) {
      threw = e instanceof BadRequestException;
    }
    eq(threw, true);
  });

  console.log('\nAll compliance tests passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

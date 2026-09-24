/**
 * Compliance module tests.
 * Run: npx ts-node src/modules/compliance/__tests__/compliance.service.spec.ts
 */
import { AssessmentStatus, AssessmentType, ItemResponse, UserRole } from '../../../common/domain';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { OptimisticLockConflictException } from '../../../common/concurrency/optimistic-lock.exception';
import { AuthUser } from '../../auth/interfaces/jwt-payload.interface';
import { ComplianceService } from '../compliance.service';
import {
  SELF_EVAL_SCORE_CODE,
  getAnswerableQuestions,
  getFacilityChecklist,
  scoreSelfEvaluationFromAnswers,
} from '../self-eval-catalog';

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
    sectorId: partial.sectorId ?? null,
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
    clientDraftId: null,
    center: { id: 'center-1', name: 'Center One', districtId: 'district-1', villageId: 'village-kimihurura' },
    ...overrides,
  };
}

const Q1 = 'dc_s711_pregnant_anc_access';
const Q2 = 'dc_s711_eight_antenatal_contacts';
const Q3 = 'dc_s711_nutritional_assessment_mms';

function threeAnswerItems() {
  return [
    { questionId: Q1, response: true },
    { questionId: Q2, response: false },
    { questionId: Q3, response: true },
  ];
}

function payloadFromItems(
  items: Array<{ questionId: string; response: boolean }>,
  overrides: Record<string, unknown> = {},
) {
  const answers = Object.fromEntries(items.map((i) => [i.questionId, i.response]));
  const score = scoreSelfEvaluationFromAnswers('daycare', answers);
  if (!score) {
    throw new Error('failed to score daycare answers');
  }
  return {
    centerId: 'center-1',
    facilityTypeId: 'daycare',
    standardsVersion: '2024.2-weighted',
    assessmentDate: '2026-09-08',
    earnedScore: score.earnedScore,
    maxScore: score.maxScore,
    percent: score.percent,
    rank: score.rank,
    items,
    ...overrides,
  };
}

function createSelfEvalPrisma(options?: {
  failOnCreateMany?: boolean;
  failOnCenterUpdate?: boolean;
  failOnItemWrite?: boolean;
}) {
  const standards = new Map<
    string,
    { id: string; code: string; title: string; weight?: number | null; version?: string | null }
  >([
    [
      'std-score',
      {
        id: 'std-score',
        code: SELF_EVAL_SCORE_CODE,
        title: 'ECD Standards self-evaluation overall score',
        weight: 100,
        version: '2024.2-weighted',
      },
    ],
  ]);
  const assessments: Record<string, unknown>[] = [];
  const items: Record<string, unknown>[] = [];
  const centerUpdates: Record<string, unknown>[] = [];
  let assessmentSeq = 0;
  let itemSeq = 0;

  const standardByCode = () => new Map([...standards.values()].map((s) => [s.code, s]));

  function matchesAssessment(
    row: Record<string, unknown>,
    where: Record<string, unknown> = {},
  ): boolean {
    if (where.id && row.id !== where.id) return false;
    if (where.centerId && row.centerId !== where.centerId) return false;
    if (where.status && row.status !== where.status) return false;
    if (where.assessmentType && row.assessmentType !== where.assessmentType) return false;
    if (where.deletedAt === null && row.deletedAt != null) return false;
    return true;
  }

  function withItems(row: Record<string, unknown>) {
    const rowItems = items
      .filter((i) => i.assessmentId === row.id && i.deletedAt == null)
      .map((i) => ({
        ...i,
        standard:
          [...standards.values()].find((s) => s.id === i.standardId) ?? {
            code: '',
            title: null,
          },
      }));
    return { ...row, items: rowItems };
  }

  function applyUpdate(row: Record<string, unknown>, data: Record<string, unknown>) {
    const next = { ...row };
    for (const [key, value] of Object.entries(data)) {
      if (value && typeof value === 'object' && 'increment' in (value as object)) {
        next[key] = Number(next[key] ?? 1) + Number((value as { increment: number }).increment);
      } else {
        next[key] = value;
      }
    }
    return next;
  }

  const assessmentApi = {
    findFirst: async ({ where }: { where?: Record<string, unknown> } = {}) => {
      const row = assessments.find((a) => matchesAssessment(a, where ?? {}));
      return row ? withItems(row) : null;
    },
    findMany: async ({ where }: { where?: Record<string, unknown> } = {}) =>
      assessments.filter((a) => matchesAssessment(a, where ?? {})).map((a) => withItems(a)),
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const hasDraft = assessments.some(
        (a) =>
          a.centerId === data.centerId &&
          a.assessmentType === AssessmentType.self_assessment &&
          a.status === AssessmentStatus.draft &&
          a.deletedAt == null,
      );
      if (
        hasDraft &&
        data.status === AssessmentStatus.draft &&
        data.assessmentType === AssessmentType.self_assessment
      ) {
        throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
        });
      }
      assessmentSeq += 1;
      const row = {
        ...assessmentRow({
          ...data,
          id: `assessment-${assessmentSeq}`,
          overallPercent: data.overallPercent,
          overallRank: data.overallRank,
          clientDraftId: data.clientDraftId ?? null,
          deletedAt: null,
        }),
      };
      assessments.push(row);
      return row;
    },
    update: async ({
      where,
      data,
    }: {
      where: { id: string };
      data: Record<string, unknown>;
    }) => {
      const idx = assessments.findIndex((a) => a.id === where.id);
      if (idx < 0) throw new Error('assessment not found');
      const next = applyUpdate(assessments[idx], data);
      assessments[idx] = next;
      return next;
    },
  };

  const itemApi = {
    findMany: async ({ where }: { where?: Record<string, unknown> } = {}) => {
      return items
        .filter((i) => {
          if (where?.assessmentId && i.assessmentId !== where.assessmentId) return false;
          if (where?.deletedAt === null && i.deletedAt != null) return false;
          if (where?.id && typeof where.id === 'object' && 'in' in (where.id as object)) {
            const ids = (where.id as { in: string[] }).in;
            if (!ids.includes(String(i.id))) return false;
          }
          return true;
        })
        .map((i) => ({
          ...i,
          standard: [...standards.values()].find((s) => s.id === i.standardId) ?? {
            code: '',
            title: null,
          },
        }));
    },
    createMany: async ({ data }: { data: Array<Record<string, unknown>> }) => {
      if (options?.failOnCreateMany || options?.failOnItemWrite) {
        throw new Error('item write failed');
      }
      for (const d of data) {
        itemSeq += 1;
        items.push({ ...d, id: `item-${itemSeq}`, deletedAt: null });
      }
      return { count: data.length };
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      if (options?.failOnItemWrite) {
        throw new Error('item write failed');
      }
      itemSeq += 1;
      const row = { ...data, id: `item-${itemSeq}`, deletedAt: null };
      items.push(row);
      return row;
    },
    update: async ({
      where,
      data,
    }: {
      where: { id: string };
      data: Record<string, unknown>;
    }) => {
      if (options?.failOnItemWrite) {
        throw new Error('item write failed');
      }
      const idx = items.findIndex((i) => i.id === where.id);
      if (idx < 0) throw new Error('item not found');
      items[idx] = applyUpdate(items[idx], data);
      return items[idx];
    },
    deleteMany: async ({ where }: { where?: { id?: { in: string[] } } } = {}) => {
      const ids = new Set(where?.id?.in ?? []);
      let count = 0;
      for (let i = items.length - 1; i >= 0; i -= 1) {
        if (ids.has(String(items[i].id))) {
          items.splice(i, 1);
          count += 1;
        }
      }
      return { count };
    },
  };

  const txApi = () => ({
    ecdStandard: {
      findUnique: async ({ where }: { where: { code: string } }) =>
        standardByCode().get(where.code) ?? null,
      findMany: async ({ where }: { where: { code: { in: string[] } } }) => {
        const wanted = new Set(where.code.in);
        return [...standards.values()].filter((s) => wanted.has(s.code));
      },
      create: async ({
        data,
      }: {
        data: { code: string; title?: string; weight?: unknown; version?: string };
      }) => {
        const row = {
          id: `std-${data.code}`,
          code: data.code,
          title: data.title ?? data.code,
          weight: data.weight != null ? Number(data.weight) : null,
          version: data.version ?? null,
        };
        standards.set(row.id, row);
        return row;
      },
      createMany: async ({
        data,
      }: {
        data: Array<{ code: string; title?: string; weight?: unknown; version?: string }>;
      }) => {
        for (const d of data) {
          if (standardByCode().has(d.code)) continue;
          const row = {
            id: `std-${d.code}`,
            code: d.code,
            title: d.title ?? d.code,
            weight: d.weight != null ? Number(d.weight) : null,
            version: d.version ?? null,
          };
          standards.set(row.id, row);
        }
        return { count: data.length };
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: { weight?: unknown; version?: string };
      }) => {
        const row = standards.get(where.id);
        if (!row) throw new Error('standard not found');
        if (data.weight !== undefined) {
          row.weight = data.weight != null ? Number(data.weight) : null;
        }
        if (data.version !== undefined) {
          row.version = data.version;
        }
        standards.set(where.id, row);
        return row;
      },
    },
    complianceAssessment: assessmentApi,
    complianceAssessmentItem: itemApi,
    ecdCenter: {
      update: async ({ data }: { data: Record<string, unknown> }) => {
        if (options?.failOnCenterUpdate) {
          throw new Error('center update failed');
        }
        centerUpdates.push(data);
        return data;
      },
    },
  });

  const prisma = {
    ecdCenter: {
      findFirst: async ({ where }: { where?: { id?: string } } = {}) => {
        if (!where?.id || where.id === 'center-1') {
          return { id: 'center-1', name: 'Center One', districtId: 'district-1', villageId: 'village-kimihurura' };
        }
        if (where.id === 'center-b') {
          return { id: 'center-b', name: 'Center B', districtId: 'district-1', villageId: 'village-kimihurura' };
        }
        if (where.id === 'center-kimironko') {
          return {
            id: 'center-kimironko',
            name: 'Kimironko Center',
            districtId: 'district-1',
            villageId: 'village-kimironko',
          };
        }
        return null;
      },
    },
    administrativeUnit: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        if (where.id === 'sector-kimihurura') {
          return { id: 'sector-kimihurura', level: 'sector', districtId: 'district-1', parentId: null };
        }
        if (where.id === 'village-kimihurura') {
          return {
            id: 'village-kimihurura',
            level: 'village',
            districtId: 'district-1',
            parentId: 'sector-kimihurura',
          };
        }
        if (where.id === 'village-kimironko') {
          return {
            id: 'village-kimironko',
            level: 'village',
            districtId: 'district-1',
            parentId: 'sector-kimironko',
          };
        }
        return null;
      },
      findMany: async ({ where }: { where: { parentId: { in: string[] } } }) => {
        const parents = new Set(where.parentId.in);
        const rows: Array<{ id: string; level: string }> = [];
        if (parents.has('sector-kimihurura')) {
          rows.push({ id: 'village-kimihurura', level: 'village' });
        }
        if (parents.has('sector-kimironko')) {
          rows.push({ id: 'village-kimironko', level: 'village' });
        }
        return rows;
      },
    },
    complianceAssessment: assessmentApi,
    complianceAssessmentItem: itemApi,
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const snapA = assessments.map((a) => ({ ...a }));
      const snapI = items.map((i) => ({ ...i }));
      const snapS = new Map(standards);
      try {
        return await fn(txApi());
      } catch (e) {
        assessments.splice(0, assessments.length, ...snapA);
        items.splice(0, items.length, ...snapI);
        standards.clear();
        for (const [k, v] of snapS) standards.set(k, v);
        throw e;
      }
    },
  };

  return { prisma, assessments, items, standards, centerUpdates };
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

  await assert('list: caregiver cannot overwrite scope with another centerId', async () => {
    const prisma = {
      $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
      complianceAssessment: {
        findMany: async () => [],
        count: async () => 0,
      },
    };
    const service = new ComplianceService(
      prisma as never,
      { log: async () => undefined } as never,
      { onComplianceAssessmentStatusChanged: async () => {} } as never,
    );

    let threw = false;
    try {
      await service.listAssessments(user({ role: UserRole.ecd_director, centerId: 'center-1' }), {
        centerId: 'center-b',
      });
    } catch (e) {
      threw = e instanceof ForbiddenException;
    }
    eq(threw, true);
  });

  await assert('submitSelfEvaluation: persists three individual answers', async () => {
    const mem = createSelfEvalPrisma();
    const notified: unknown[] = [];
    const service = new ComplianceService(
      mem.prisma as never,
      { log: async () => undefined } as never,
      {
        onComplianceAssessmentStatusChanged: async (payload: unknown) => {
          notified.push(payload);
        },
      } as never,
    );

    const dto = payloadFromItems(threeAnswerItems());
    const result = await service.submitSelfEvaluation(
      user({ role: UserRole.ecd_director, centerId: 'center-1' }),
      dto,
    );

    eq(mem.assessments.length, 1);
    eq(result.overallRank, dto.rank);
    eq(result.overallPercent, dto.percent);

    const byCode = new Map(
      mem.items.map((item) => {
        const standard = [...mem.standards.values()].find((s) => s.id === item.standardId);
        return [standard?.code ?? '', item];
      }),
    );

    eq(byCode.get(Q1)?.response, ItemResponse.met);
    eq(byCode.get(Q2)?.response, ItemResponse.not_met);
    eq(byCode.get(Q3)?.response, ItemResponse.met);
    eq(byCode.has(SELF_EVAL_SCORE_CODE), true);
    eq(mem.items.length, 4);
    eq(mem.centerUpdates.length, 1);
    eq(notified.length, 1);
  });

  await assert('submitSelfEvaluation: GET reconstructs individual answers', async () => {
    const mem = createSelfEvalPrisma();
    const service = new ComplianceService(
      mem.prisma as never,
      { log: async () => undefined } as never,
      { onComplianceAssessmentStatusChanged: async () => {} } as never,
    );

    const created = await service.submitSelfEvaluation(
      user({ role: UserRole.ecd_director, centerId: 'center-1' }),
      payloadFromItems(threeAnswerItems()),
    );

    const detail = await service.getAssessment(
      user({ role: UserRole.ecd_director, centerId: 'center-1' }),
      created.id,
    );

    const answers = Object.fromEntries(
      detail.items
        .filter((item) => item.standardCode !== SELF_EVAL_SCORE_CODE)
        .map((item) => [item.standardCode, item.response === ItemResponse.met]),
    );

    eq(answers[Q1], true);
    eq(answers[Q2], false);
    eq(answers[Q3], true);
  });

  await assert('submitSelfEvaluation: invalid question is atomic (no assessment row)', async () => {
    const mem = createSelfEvalPrisma();
    const service = new ComplianceService(
      mem.prisma as never,
      { log: async () => undefined } as never,
      { onComplianceAssessmentStatusChanged: async () => {} } as never,
    );

    const items = [...threeAnswerItems(), { questionId: 'not-a-real-question', response: true }];
    let threw = false;
    try {
      await service.submitSelfEvaluation(
        user({ role: UserRole.ecd_director, centerId: 'center-1' }),
        payloadFromItems(threeAnswerItems(), { items }),
      );
    } catch (e) {
      threw = e instanceof BadRequestException;
    }
    eq(threw, true);
    eq(mem.assessments.length, 0);
    eq(mem.items.length, 0);
  });

  await assert('submitSelfEvaluation: createMany failure rolls back assessment', async () => {
    const mem = createSelfEvalPrisma({ failOnItemWrite: true });
    const service = new ComplianceService(
      mem.prisma as never,
      { log: async () => undefined } as never,
      { onComplianceAssessmentStatusChanged: async () => {} } as never,
    );

    let threw = false;
    try {
      await service.submitSelfEvaluation(
        user({ role: UserRole.ecd_director, centerId: 'center-1' }),
        payloadFromItems(threeAnswerItems()),
      );
    } catch {
      threw = true;
    }
    eq(threw, true);
    eq(mem.assessments.length, 0);
    eq(mem.items.length, 0);
  });

  await assert('submitSelfEvaluation: duplicate questionId is rejected', async () => {
    const mem = createSelfEvalPrisma();
    const service = new ComplianceService(
      mem.prisma as never,
      { log: async () => undefined } as never,
      { onComplianceAssessmentStatusChanged: async () => {} } as never,
    );

    let threw = false;
    try {
      await service.submitSelfEvaluation(
        user({ role: UserRole.ecd_director, centerId: 'center-1' }),
        payloadFromItems(threeAnswerItems(), {
          items: [
            { questionId: Q1, response: true },
            { questionId: Q1, response: false },
          ],
        }),
      );
    } catch (e) {
      threw = e instanceof BadRequestException;
    }
    eq(threw, true);
    eq(mem.assessments.length, 0);
  });

  await assert('submitSelfEvaluation: center A cannot submit for center B', async () => {
    const mem = createSelfEvalPrisma();
    const service = new ComplianceService(
      mem.prisma as never,
      { log: async () => undefined } as never,
      { onComplianceAssessmentStatusChanged: async () => {} } as never,
    );

    let threw = false;
    try {
      await service.submitSelfEvaluation(
        user({ role: UserRole.ecd_director, centerId: 'center-1' }),
        payloadFromItems(threeAnswerItems(), { centerId: 'center-b' }),
      );
    } catch (e) {
      threw = e instanceof ForbiddenException;
    }
    eq(threw, true);
    eq(mem.assessments.length, 0);
  });

  await assert('getAssessment: center B cannot retrieve center A assessment', async () => {
    const mem = createSelfEvalPrisma();
    const service = new ComplianceService(
      mem.prisma as never,
      { log: async () => undefined } as never,
      { onComplianceAssessmentStatusChanged: async () => {} } as never,
    );

    const created = await service.submitSelfEvaluation(
      user({ role: UserRole.ecd_director, centerId: 'center-1' }),
      payloadFromItems(threeAnswerItems()),
    );

    let threw = false;
    try {
      await service.getAssessment(
        user({ role: UserRole.ecd_director, centerId: 'center-b' }),
        created.id,
      );
    } catch (e) {
      threw = e instanceof ForbiddenException;
    }
    eq(threw, true);
  });

  await assert('submitSelfEvaluation: history keeps independent answer sets', async () => {
    const mem = createSelfEvalPrisma();
    const service = new ComplianceService(
      mem.prisma as never,
      { log: async () => undefined } as never,
      { onComplianceAssessmentStatusChanged: async () => {} } as never,
    );

    const first = await service.submitSelfEvaluation(
      user({ role: UserRole.ecd_director, centerId: 'center-1' }),
      payloadFromItems(threeAnswerItems(), { assessmentDate: '2026-01-15' }),
    );
    const secondItems = [
      { questionId: Q1, response: false },
      { questionId: Q2, response: false },
      { questionId: Q3, response: false },
    ];
    const second = await service.submitSelfEvaluation(
      user({ role: UserRole.ecd_director, centerId: 'center-1' }),
      payloadFromItems(secondItems, { assessmentDate: '2026-04-15' }),
    );

    eq(mem.assessments.length, 2);
    eq(first.id === second.id, false);

    const firstDetail = await service.getAssessment(
      user({ role: UserRole.ecd_director, centerId: 'center-1' }),
      first.id,
    );
    const secondDetail = await service.getAssessment(
      user({ role: UserRole.ecd_director, centerId: 'center-1' }),
      second.id,
    );

    const pick = (detail: { items: Array<{ standardCode: string; response: string }> }) =>
      Object.fromEntries(
        detail.items
          .filter((item) => item.standardCode !== SELF_EVAL_SCORE_CODE)
          .map((item) => [item.standardCode, item.response]),
      );

    eq(pick(firstDetail)[Q1], ItemResponse.met);
    eq(pick(secondDetail)[Q1], ItemResponse.not_met);
    eq(pick(secondDetail)[Q2], ItemResponse.not_met);
    eq(pick(secondDetail)[Q3], ItemResponse.not_met);
  });

  await assert('submitSelfEvaluation: aggregate percent/rank still persist', async () => {
    const mem = createSelfEvalPrisma();
    const service = new ComplianceService(
      mem.prisma as never,
      { log: async () => undefined } as never,
      { onComplianceAssessmentStatusChanged: async () => {} } as never,
    );

    const daycareMax = getFacilityChecklist('daycare')!.computedMaxScore;
    // Target ~84% under the hybrid weighted denominator (was 168/199 before WEIGHT-01).
    const targetEarned = Math.round((84 / 100) * daycareMax);
    const answers: Array<{ questionId: string; response: boolean }> = [];
    let earned = 0;
    for (const q of getAnswerableQuestions('daycare').values()) {
      const met = earned < targetEarned;
      if (met) earned += q.maxScore;
      answers.push({ questionId: q.questionId, response: met });
    }

    const expected = scoreSelfEvaluationFromAnswers(
      'daycare',
      Object.fromEntries(answers.map((a) => [a.questionId, a.response])),
    )!;

    const result = await service.submitSelfEvaluation(
      user({ role: UserRole.ecd_director, centerId: 'center-1' }),
      payloadFromItems(answers),
    );

    eq(result.overallPercent, expected.percent);
    eq(result.overallRank, expected.rank);
    eq(expected.percent >= 70 && expected.percent <= 89, true);
    eq(mem.assessments[0]?.overallRank, expected.rank);
  });

  await assert('submitSelfEvaluation: rejects mismatched percent', async () => {
    const mem = createSelfEvalPrisma();
    const service = new ComplianceService(
      mem.prisma as never,
      { log: async () => undefined } as never,
      { onComplianceAssessmentStatusChanged: async () => {} } as never,
    );

    let threw = false;
    try {
      await service.submitSelfEvaluation(
        user({ role: UserRole.ecd_director, centerId: 'center-1' }),
        payloadFromItems(threeAnswerItems(), { percent: 99, rank: 'green' }),
      );
    } catch (e) {
      threw = e instanceof BadRequestException;
    }
    eq(threw, true);
    eq(mem.assessments.length, 0);
  });

  await assert('submitSelfEvaluation: rejects daycare question on ecd_3_5', async () => {
    const mem = createSelfEvalPrisma();
    const service = new ComplianceService(
      mem.prisma as never,
      { log: async () => undefined } as never,
      { onComplianceAssessmentStatusChanged: async () => {} } as never,
    );

    let threw = false;
    try {
      await service.submitSelfEvaluation(
        user({ role: UserRole.ecd_director, centerId: 'center-1' }),
        payloadFromItems(threeAnswerItems(), {
          facilityTypeId: 'ecd_3_5',
          standardsVersion: '2024.2-weighted',
          maxScore: getFacilityChecklist('ecd_3_5')!.computedMaxScore,
        }),
      );
    } catch (e) {
      threw = e instanceof BadRequestException;
    }
    eq(threw, true);
    eq(mem.assessments.length, 0);
  });

  await assert('saveSelfEvalDraft: creates draft with two answers', async () => {
    const mem = createSelfEvalPrisma();
    const service = new ComplianceService(
      mem.prisma as never,
      { log: async () => undefined } as never,
      { onComplianceAssessmentStatusChanged: async () => {} } as never,
    );
    const saved = await service.saveSelfEvalDraft(
      user({ role: UserRole.ecd_director, centerId: 'center-1' }),
      {
        facilityTypeId: 'daycare',
        standardsVersion: '2024.2-weighted',
        assessmentDate: '2026-09-08',
        clientDraftId: 'client-draft-1',
        items: [
          { questionId: Q1, response: true },
          { questionId: Q2, response: false },
        ],
      },
    );
    eq(saved.status, AssessmentStatus.draft);
    eq(mem.assessments.length, 1);
    const answers = Object.fromEntries(
      saved.items
        .filter((i) => i.standardCode !== SELF_EVAL_SCORE_CODE)
        .map((i) => [i.standardCode, i.response]),
    );
    eq(answers[Q1], ItemResponse.met);
    eq(answers[Q2], ItemResponse.not_met);
    eq(saved.clientDraftId, 'client-draft-1');
  });

  await assert('saveSelfEvalDraft: update same draft without duplicating', async () => {
    const mem = createSelfEvalPrisma();
    const service = new ComplianceService(
      mem.prisma as never,
      { log: async () => undefined } as never,
      { onComplianceAssessmentStatusChanged: async () => {} } as never,
    );
    const first = await service.saveSelfEvalDraft(
      user({ role: UserRole.ecd_director, centerId: 'center-1' }),
      {
        facilityTypeId: 'daycare',
        standardsVersion: '2024.2-weighted',
        assessmentDate: '2026-09-08',
        clientDraftId: 'client-draft-1',
        items: [
          { questionId: Q1, response: true },
          { questionId: Q2, response: false },
        ],
      },
    );
    const second = await service.saveSelfEvalDraft(
      user({ role: UserRole.ecd_director, centerId: 'center-1' }),
      {
        facilityTypeId: 'daycare',
        standardsVersion: '2024.2-weighted',
        assessmentDate: '2026-09-08',
        clientDraftId: 'client-draft-1',
        items: [
          { questionId: Q1, response: true },
          { questionId: Q2, response: true },
          { questionId: Q3, response: false },
        ],
      },
    );
    eq(first.id, second.id);
    eq(mem.assessments.length, 1);
    const answers = Object.fromEntries(
      second.items
        .filter((i) => i.standardCode !== SELF_EVAL_SCORE_CODE)
        .map((i) => [i.standardCode, i.response]),
    );
    eq(answers[Q1], ItemResponse.met);
    eq(answers[Q2], ItemResponse.met);
    eq(answers[Q3], ItemResponse.not_met);
  });

  await assert('saveSelfEvalDraft: partial draft succeeds', async () => {
    const mem = createSelfEvalPrisma();
    const service = new ComplianceService(
      mem.prisma as never,
      { log: async () => undefined } as never,
      { onComplianceAssessmentStatusChanged: async () => {} } as never,
    );
    const saved = await service.saveSelfEvalDraft(
      user({ role: UserRole.ecd_director, centerId: 'center-1' }),
      {
        facilityTypeId: 'daycare',
        standardsVersion: '2024.2-weighted',
        assessmentDate: '2026-09-08',
        items: [{ questionId: Q1, response: true }],
      },
    );
    eq(saved.items.length, 1);
    eq(saved.status, AssessmentStatus.draft);
  });

  await assert('getSelfEvalDraft: resume returns codes and responses', async () => {
    const mem = createSelfEvalPrisma();
    const service = new ComplianceService(
      mem.prisma as never,
      { log: async () => undefined } as never,
      { onComplianceAssessmentStatusChanged: async () => {} } as never,
    );
    await service.saveSelfEvalDraft(user({ role: UserRole.ecd_director, centerId: 'center-1' }), {
      facilityTypeId: 'daycare',
      standardsVersion: '2024.2-weighted',
      assessmentDate: '2026-09-08',
      items: [
        { questionId: Q1, response: true },
        { questionId: Q2, response: false },
      ],
    });
    const envelope = await service.getSelfEvalDraft(
      user({ role: UserRole.ecd_director, centerId: 'center-1' }),
    );
    eq(envelope.draft != null, true);
    const answers = Object.fromEntries(
      envelope.draft!.items.map((i) => [i.standardCode, i.response === ItemResponse.met]),
    );
    eq(answers[Q1], true);
    eq(answers[Q2], false);
  });

  await assert('self-eval draft: center A cannot read or update center B', async () => {
    const mem = createSelfEvalPrisma();
    const service = new ComplianceService(
      mem.prisma as never,
      { log: async () => undefined } as never,
      { onComplianceAssessmentStatusChanged: async () => {} } as never,
    );
    await service.saveSelfEvalDraft(user({ role: UserRole.ecd_director, centerId: 'center-1' }), {
      facilityTypeId: 'daycare',
      standardsVersion: '2024.2-weighted',
      assessmentDate: '2026-09-08',
      items: [{ questionId: Q1, response: true }],
    });
    const other = await service.getSelfEvalDraft(
      user({ role: UserRole.ecd_director, centerId: 'center-b' }),
    );
    eq(other.draft, null);

    await service.saveSelfEvalDraft(user({ role: UserRole.ecd_director, centerId: 'center-b' }), {
      facilityTypeId: 'daycare',
      standardsVersion: '2024.2-weighted',
      assessmentDate: '2026-09-08',
      items: [{ questionId: Q2, response: false }],
    });
    eq(mem.assessments.length, 2);
    const a = await service.getSelfEvalDraft(user({ role: UserRole.ecd_director, centerId: 'center-1' }));
    eq(a.draft!.items[0].standardCode, Q1);
  });

  await assert('saveSelfEvalDraft: does not mutate submitted history', async () => {
    const mem = createSelfEvalPrisma();
    const service = new ComplianceService(
      mem.prisma as never,
      { log: async () => undefined } as never,
      { onComplianceAssessmentStatusChanged: async () => {} } as never,
    );
    const submitted = await service.submitSelfEvaluation(
      user({ role: UserRole.ecd_director, centerId: 'center-1' }),
      payloadFromItems(threeAnswerItems(), { assessmentDate: '2026-01-15' }),
    );
    const draft = await service.saveSelfEvalDraft(
      user({ role: UserRole.ecd_director, centerId: 'center-1' }),
      {
        facilityTypeId: 'daycare',
        standardsVersion: '2024.2-weighted',
        assessmentDate: '2026-09-08',
        items: [{ questionId: Q1, response: false }],
      },
    );
    eq(mem.assessments.length, 2);
    eq(submitted.id === draft.id, false);
    const historical = await service.getAssessment(
      user({ role: UserRole.ecd_director, centerId: 'center-1' }),
      submitted.id,
    );
    eq(historical.status, AssessmentStatus.submitted);
    const histAnswers = Object.fromEntries(
      historical.items
        .filter((i) => i.standardCode !== SELF_EVAL_SCORE_CODE)
        .map((i) => [i.standardCode, i.response]),
    );
    eq(histAnswers[Q1], ItemResponse.met);
  });

  await assert('submitSelfEvaluation: finalizes existing draft in place', async () => {
    const mem = createSelfEvalPrisma();
    const service = new ComplianceService(
      mem.prisma as never,
      { log: async () => undefined } as never,
      { onComplianceAssessmentStatusChanged: async () => {} } as never,
    );
    const draft = await service.saveSelfEvalDraft(
      user({ role: UserRole.ecd_director, centerId: 'center-1' }),
      {
        facilityTypeId: 'daycare',
        standardsVersion: '2024.2-weighted',
        assessmentDate: '2026-09-08',
        clientDraftId: 'client-draft-1',
        items: [
          { questionId: Q1, response: true },
          { questionId: Q2, response: false },
        ],
      },
    );
    const submitted = await service.submitSelfEvaluation(
      user({ role: UserRole.ecd_director, centerId: 'center-1' }),
      payloadFromItems(threeAnswerItems(), { assessmentId: draft.id, clientDraftId: 'client-draft-1' }),
    );
    eq(submitted.id, draft.id);
    eq(submitted.status, AssessmentStatus.submitted);
    eq(mem.assessments.length, 1);
    const envelope = await service.getSelfEvalDraft(
      user({ role: UserRole.ecd_director, centerId: 'center-1' }),
    );
    eq(envelope.draft, null);
    const detail = await service.getAssessment(
      user({ role: UserRole.ecd_director, centerId: 'center-1' }),
      submitted.id,
    );
    const answers = Object.fromEntries(
      detail.items
        .filter((i) => i.standardCode !== SELF_EVAL_SCORE_CODE)
        .map((i) => [i.standardCode, i.response]),
    );
    eq(answers[Q1], ItemResponse.met);
    eq(answers[Q2], ItemResponse.not_met);
    eq(answers[Q3], ItemResponse.met);
    eq(detail.overallPercent, payloadFromItems(threeAnswerItems()).percent);
    eq(detail.items.some((i) => i.standardCode === SELF_EVAL_SCORE_CODE), true);
  });

  await assert('submitSelfEvaluation: failed finalize leaves draft recoverable', async () => {
    const mem = createSelfEvalPrisma({ failOnCenterUpdate: true });
    const service = new ComplianceService(
      mem.prisma as never,
      { log: async () => undefined } as never,
      { onComplianceAssessmentStatusChanged: async () => {} } as never,
    );
    await service.saveSelfEvalDraft(user({ role: UserRole.ecd_director, centerId: 'center-1' }), {
      facilityTypeId: 'daycare',
      standardsVersion: '2024.2-weighted',
      assessmentDate: '2026-09-08',
      items: [
        { questionId: Q1, response: true },
        { questionId: Q2, response: false },
      ],
    });
    let threw = false;
    try {
      await service.submitSelfEvaluation(
        user({ role: UserRole.ecd_director, centerId: 'center-1' }),
        payloadFromItems(threeAnswerItems()),
      );
    } catch {
      threw = true;
    }
    eq(threw, true);
    const envelope = await service.getSelfEvalDraft(
      user({ role: UserRole.ecd_director, centerId: 'center-1' }),
    );
    eq(envelope.draft != null, true);
    eq(envelope.draft!.status, AssessmentStatus.draft);
    eq(envelope.draft!.items.some((i) => i.standardCode === Q1), true);
  });

  await assert('saveSelfEvalDraft: concurrent create reuses one draft', async () => {
    const mem = createSelfEvalPrisma();
    const service = new ComplianceService(
      mem.prisma as never,
      { log: async () => undefined } as never,
      { onComplianceAssessmentStatusChanged: async () => {} } as never,
    );
    const first = await service.saveSelfEvalDraft(
      user({ role: UserRole.ecd_director, centerId: 'center-1' }),
      {
        facilityTypeId: 'daycare',
        standardsVersion: '2024.2-weighted',
        assessmentDate: '2026-09-08',
        items: [{ questionId: Q1, response: true }],
      },
    );
    const second = await service.saveSelfEvalDraft(
      user({ role: UserRole.ecd_director, centerId: 'center-1' }),
      {
        facilityTypeId: 'daycare',
        standardsVersion: '2024.2-weighted',
        assessmentDate: '2026-09-08',
        items: [{ questionId: Q2, response: false }],
      },
    );
    eq(first.id, second.id);
    eq(mem.assessments.filter((a) => a.status === AssessmentStatus.draft).length, 1);
  });

  await assert('saveSelfEvalDraft: authoritative item sync removes stale answers', async () => {
    const mem = createSelfEvalPrisma();
    const service = new ComplianceService(
      mem.prisma as never,
      { log: async () => undefined } as never,
      { onComplianceAssessmentStatusChanged: async () => {} } as never,
    );
    await service.saveSelfEvalDraft(user({ role: UserRole.ecd_director, centerId: 'center-1' }), {
      facilityTypeId: 'daycare',
      standardsVersion: '2024.2-weighted',
      assessmentDate: '2026-09-08',
      items: [
        { questionId: Q1, response: true },
        { questionId: Q2, response: false },
        { questionId: Q3, response: true },
      ],
    });
    const saved = await service.saveSelfEvalDraft(
      user({ role: UserRole.ecd_director, centerId: 'center-1' }),
      {
        facilityTypeId: 'daycare',
        standardsVersion: '2024.2-weighted',
        assessmentDate: '2026-09-08',
        items: [
          { questionId: Q1, response: true },
          { questionId: Q3, response: false },
        ],
      },
    );
    const codes = saved.items.map((i) => i.standardCode).sort();
    eq(codes, [Q1, Q3].sort());
    const answers = Object.fromEntries(saved.items.map((i) => [i.standardCode, i.response]));
    eq(answers[Q1], ItemResponse.met);
    eq(answers[Q3], ItemResponse.not_met);
  });

  await assert('SELF-EVAL-WEIGHT-01: weighted Yes stores official maxScore on item', async () => {
    const mem = createSelfEvalPrisma();
    const service = new ComplianceService(
      mem.prisma as never,
      { log: async () => undefined } as never,
      { onComplianceAssessmentStatusChanged: async () => {} } as never,
    );

    const weightedId = 'dc_s713r_accreditation_certificate';
    const weightedDef = getAnswerableQuestions('daycare').get(weightedId);
    eq(weightedDef?.maxScore, 2);

    const result = await service.submitSelfEvaluation(
      user({ role: UserRole.ecd_director, centerId: 'center-1' }),
      payloadFromItems([{ questionId: weightedId, response: true }]),
    );

    const expected = scoreSelfEvaluationFromAnswers('daycare', { [weightedId]: true })!;
    eq(result.overallPercent, expected.percent);
    eq(result.standardsVersion?.includes('2024.2-weighted'), true);

    const std = [...mem.standards.values()].find((s) => s.code === weightedId);
    eq(std?.weight, 2);
    const item = mem.items.find((i) => i.standardId === std?.id && i.assessmentId === result.id);
    eq(Number(item?.score), 2);
    eq(item?.response, ItemResponse.met);
  });

  await assert('SELF-EVAL-WEIGHT-01: No stores score 0 for weighted question', async () => {
    const mem = createSelfEvalPrisma();
    const service = new ComplianceService(
      mem.prisma as never,
      { log: async () => undefined } as never,
      { onComplianceAssessmentStatusChanged: async () => {} } as never,
    );

    const weightedId = 'dc_s716_required_rooms';
    eq(getAnswerableQuestions('daycare').get(weightedId)?.maxScore, 7);

    await service.submitSelfEvaluation(
      user({ role: UserRole.ecd_director, centerId: 'center-1' }),
      payloadFromItems([{ questionId: weightedId, response: false }]),
    );

    const std = [...mem.standards.values()].find((s) => s.code === weightedId);
    const item = mem.items.find((i) => i.standardId === std?.id);
    eq(Number(item?.score), 0);
    eq(item?.response, ItemResponse.not_met);
  });

  await assert('SELF-EVAL-WEIGHT-01: updates existing EcdStandard.weight without duplicating', async () => {
    const mem = createSelfEvalPrisma();
    const weightedId = 'dc_s713r_occurrence_logbook_kept';
    mem.standards.set('std-preexisting', {
      id: 'std-preexisting',
      code: weightedId,
      title: 'preexisting',
      weight: 1,
      version: '2024.1',
    });

    const service = new ComplianceService(
      mem.prisma as never,
      { log: async () => undefined } as never,
      { onComplianceAssessmentStatusChanged: async () => {} } as never,
    );

    await service.submitSelfEvaluation(
      user({ role: UserRole.ecd_director, centerId: 'center-1' }),
      payloadFromItems([{ questionId: weightedId, response: true }]),
    );

    const matches = [...mem.standards.values()].filter((s) => s.code === weightedId);
    eq(matches.length, 1);
    eq(matches[0]?.id, 'std-preexisting');
    eq(matches[0]?.weight, 2);
    eq(matches[0]?.version, '2024.2-weighted');
  });

  await assert('SELF-EVAL-WEIGHT-01: rejects client score using old equal-weight denominator', async () => {
    const mem = createSelfEvalPrisma();
    const service = new ComplianceService(
      mem.prisma as never,
      { log: async () => undefined } as never,
      { onComplianceAssessmentStatusChanged: async () => {} } as never,
    );

    const weightedId = 'dc_s713r_accreditation_certificate';
    let threw = false;
    try {
      await service.submitSelfEvaluation(
        user({ role: UserRole.ecd_director, centerId: 'center-1' }),
        payloadFromItems([{ questionId: weightedId, response: true }], {
          // Old equal-weight model: 1 earned / 199 max
          earnedScore: 1,
          maxScore: 199,
          percent: 1,
          rank: 'red',
        }),
      );
    } catch (e) {
      threw = e instanceof BadRequestException;
    }
    eq(threw, true);
    eq(mem.assessments.length, 0);
  });

  await assert('SELF-EVAL-WEIGHT-01: hybrid daycare max is not official 195 or old 199', async () => {
    const daycare = getFacilityChecklist('daycare')!;
    eq(daycare.itemCount, 199);
    eq(daycare.computedMaxScore, 230);
    eq(daycare.version, '2024.2-weighted');
    const ecd = getFacilityChecklist('ecd_3_5')!;
    eq(ecd.itemCount, 271);
    eq(ecd.computedMaxScore, 312);
  });

  // --- INSPECTION-UI-02 ---

  await assert('AUTH: director self-eval allowed', async () => {
    const mem = createSelfEvalPrisma();
    const service = new ComplianceService(
      mem.prisma as never,
      { log: async () => undefined } as never,
      { onComplianceAssessmentStatusChanged: async () => {} } as never,
    );
    const draft = await service.saveSelfEvalDraft(
      user({ role: UserRole.ecd_director, centerId: 'center-1' }),
      {
        facilityTypeId: 'daycare',
        standardsVersion: '2024.2-weighted',
        assessmentDate: '2026-09-08',
        items: [{ questionId: Q1, response: true }],
      },
    );
    eq(draft.status, AssessmentStatus.draft);
  });

  await assert('AUTH: caregiver self-eval denied', async () => {
    const mem = createSelfEvalPrisma();
    const service = new ComplianceService(
      mem.prisma as never,
      { log: async () => undefined } as never,
      { onComplianceAssessmentStatusChanged: async () => {} } as never,
    );
    let threw = false;
    try {
      await service.saveSelfEvalDraft(user({ role: UserRole.caregiver, centerId: 'center-1' }), {
        facilityTypeId: 'daycare',
        standardsVersion: '2024.2-weighted',
        assessmentDate: '2026-09-08',
        items: [],
      });
    } catch (e) {
      threw = e instanceof ForbiddenException;
    }
    eq(threw, true);
  });

  await assert('AUTH: district self-eval denied', async () => {
    const mem = createSelfEvalPrisma();
    const service = new ComplianceService(
      mem.prisma as never,
      { log: async () => undefined } as never,
      { onComplianceAssessmentStatusChanged: async () => {} } as never,
    );
    let threw = false;
    try {
      await service.getSelfEvalDraft(
        user({ role: UserRole.district_focal_person, districtId: 'district-1' }),
      );
    } catch (e) {
      threw = e instanceof ForbiddenException;
    }
    eq(threw, true);
  });

  await assert('AUTH: sector self-eval denied', async () => {
    const mem = createSelfEvalPrisma();
    const service = new ComplianceService(
      mem.prisma as never,
      { log: async () => undefined } as never,
      { onComplianceAssessmentStatusChanged: async () => {} } as never,
    );
    let threw = false;
    try {
      await service.submitSelfEvaluation(
        user({
          role: UserRole.sector_focal_person,
          districtId: 'district-1',
          sectorId: 'sector-kimihurura',
          centerId: 'center-1',
        }),
        payloadFromItems(threeAnswerItems()),
      );
    } catch (e) {
      threw = e instanceof ForbiddenException;
    }
    eq(threw, true);
  });

  await assert('TYPE: district portal cannot create self_assessment', async () => {
    const mem = createSelfEvalPrisma();
    const service = new ComplianceService(
      mem.prisma as never,
      { log: async () => undefined } as never,
      { onComplianceAssessmentStatusChanged: async () => {} } as never,
    );
    let threw = false;
    try {
      await service.createAssessment(
        user({ role: UserRole.district_focal_person, districtId: 'district-1' }),
        {
          centerId: 'center-1',
          standardsVersion: '2024.2-weighted',
          assessmentType: AssessmentType.self_assessment,
          assessmentDate: '2026-09-08',
        },
      );
    } catch (e) {
      threw = e instanceof ForbiddenException;
    }
    eq(threw, true);
  });

  await assert('TYPE: sector portal cannot create self_assessment', async () => {
    const mem = createSelfEvalPrisma();
    const service = new ComplianceService(
      mem.prisma as never,
      { log: async () => undefined } as never,
      { onComplianceAssessmentStatusChanged: async () => {} } as never,
    );
    let threw = false;
    try {
      await service.createAssessment(
        user({
          role: UserRole.sector_focal_person,
          districtId: 'district-1',
          sectorId: 'sector-kimihurura',
        }),
        {
          centerId: 'center-1',
          standardsVersion: '2024.2-weighted',
          assessmentType: AssessmentType.self_assessment,
          assessmentDate: '2026-09-08',
        },
      );
    } catch (e) {
      threw = e instanceof ForbiddenException;
    }
    eq(threw, true);
  });

  await assert('LIST: assessmentType filter works and excludes other types', async () => {
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
    const service = new ComplianceService(
      prisma as never,
      { log: async () => undefined } as never,
      { onComplianceAssessmentStatusChanged: async () => {} } as never,
    );
    await service.listAssessments(
      user({ role: UserRole.district_focal_person, districtId: 'district-1' }),
      { assessmentType: AssessmentType.supportive_supervision },
    );
    eq(captured.where!.assessmentType, AssessmentType.supportive_supervision);
  });

  await assert('INSPECTION: district can create draft', async () => {
    const mem = createSelfEvalPrisma();
    const service = new ComplianceService(
      mem.prisma as never,
      { log: async () => undefined } as never,
      { onComplianceAssessmentStatusChanged: async () => {} } as never,
    );
    const draft = await service.createInspection(
      user({ role: UserRole.district_focal_person, districtId: 'district-1' }),
      {
        centerId: 'center-1',
        facilityTypeId: 'daycare',
        standardsVersion: '2024.2-weighted',
        assessmentDate: '2026-09-08',
      },
    );
    eq(draft.assessmentType, AssessmentType.supportive_supervision);
    eq(draft.status, AssessmentStatus.draft);
  });

  await assert('INSPECTION: sector can create draft inside sector', async () => {
    const mem = createSelfEvalPrisma();
    const service = new ComplianceService(
      mem.prisma as never,
      { log: async () => undefined } as never,
      { onComplianceAssessmentStatusChanged: async () => {} } as never,
    );
    const draft = await service.createInspection(
      user({
        role: UserRole.sector_focal_person,
        districtId: 'district-1',
        sectorId: 'sector-kimihurura',
      }),
      {
        centerId: 'center-1',
        facilityTypeId: 'daycare',
        standardsVersion: '2024.2-weighted',
        assessmentDate: '2026-09-08',
      },
    );
    eq(draft.assessmentType, AssessmentType.supportive_supervision);
  });

  await assert('INSPECTION: sector cannot inspect foreign-sector center', async () => {
    const mem = createSelfEvalPrisma();
    const service = new ComplianceService(
      mem.prisma as never,
      { log: async () => undefined } as never,
      { onComplianceAssessmentStatusChanged: async () => {} } as never,
    );
    let threw = false;
    try {
      await service.createInspection(
        user({
          role: UserRole.sector_focal_person,
          districtId: 'district-1',
          sectorId: 'sector-kimihurura',
        }),
        {
          centerId: 'center-kimironko',
          facilityTypeId: 'daycare',
          standardsVersion: '2024.2-weighted',
          assessmentDate: '2026-09-08',
        },
      );
    } catch (e) {
      threw = e instanceof ForbiddenException;
    }
    eq(threw, true);
  });

  await assert('INSPECTION: answers persist by questionId; unknown rejected; submit scores', async () => {
    const notifications: unknown[] = [];
    const mem = createSelfEvalPrisma();
    const service = new ComplianceService(
      mem.prisma as never,
      { log: async () => undefined } as never,
      {
        onComplianceAssessmentStatusChanged: async (payload: unknown) => {
          notifications.push(payload);
        },
      } as never,
    );
    const district = user({ role: UserRole.district_focal_person, districtId: 'district-1', id: 'inspector-1' });
    const draft = await service.createInspection(district, {
      centerId: 'center-1',
      facilityTypeId: 'daycare',
      standardsVersion: '2024.2-weighted',
      assessmentDate: '2026-09-08',
    });

    const saved = await service.saveInspectionDraft(district, draft.id, {
      facilityTypeId: 'daycare',
      standardsVersion: '2024.2-weighted',
      assessmentDate: '2026-09-08',
      items: threeAnswerItems(),
    });
    const codes = saved.items.map((i) => i.standardCode).sort();
    eq(codes, [Q1, Q2, Q3].sort());

    let unknownThrew = false;
    try {
      await service.saveInspectionDraft(district, draft.id, {
        facilityTypeId: 'daycare',
        standardsVersion: '2024.2-weighted',
        assessmentDate: '2026-09-08',
        items: [{ questionId: 'not_a_real_question', response: true }],
      });
    } catch (e) {
      unknownThrew = e instanceof BadRequestException;
    }
    eq(unknownThrew, true);

    let forgeThrew = false;
    try {
      await service.submitInspection(district, draft.id, {
        ...payloadFromItems(threeAnswerItems()),
        percent: 99,
        rank: 'green',
      });
    } catch (e) {
      forgeThrew = e instanceof BadRequestException;
    }
    eq(forgeThrew, true);

    const expected = payloadFromItems(threeAnswerItems());
    const submitted = await service.submitInspection(district, draft.id, {
      facilityTypeId: expected.facilityTypeId,
      standardsVersion: expected.standardsVersion,
      assessmentDate: expected.assessmentDate,
      earnedScore: expected.earnedScore,
      maxScore: expected.maxScore,
      percent: expected.percent,
      rank: expected.rank,
      items: expected.items,
    });
    eq(submitted.status, AssessmentStatus.submitted);
    eq(submitted.overallPercent, expected.percent);
    eq(submitted.overallRank, expected.rank);
    eq(submitted.submittedById, 'inspector-1');
    eq(submitted.submittedAt != null, true);
    eq(notifications.length, 1);

    const selfEval = await service.submitSelfEvaluation(
      user({ role: UserRole.ecd_director, centerId: 'center-1' }),
      payloadFromItems(threeAnswerItems()),
    );
    eq(selfEval.overallPercent, submitted.overallPercent);
    eq(selfEval.overallRank, submitted.overallRank);
  });

  console.log('\nAll compliance tests passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

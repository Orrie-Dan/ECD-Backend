/**
 * NCDA ECD code tests: helpers + CentersService create / override / update.
 * Run: npx ts-node src/modules/centers/__tests__/ecd-code.spec.ts
 *
 * Code issuing itself lives in Postgres (survey.issue_ecd_code); these tests
 * prove the service calls it correctly and never writes a client-chosen code.
 * DB-level behaviour is covered by scripts/verify-ecd-coding.ts.
 */
import { EcdCenterStatus, UserRole } from '../../../common/domain';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { AuditAction } from '../../../common/audit';
import { AuthUser } from '../../auth/interfaces/jwt-payload.interface';
import { CentersService } from '../centers.service';
import {
  NCDA_ECD_CODE_PATTERN,
  isValidStartYear,
  mapEcdCodeDbError,
  resolveTypeUpdate,
} from '../ecd-code';

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

async function rejects(
  fn: () => Promise<unknown>,
  type: new (...args: never[]) => Error,
  text?: string,
) {
  try {
    await fn();
  } catch (e) {
    if (!(e instanceof type))
      throw new Error(
        `expected ${type.name}, got ${(e as Error)?.constructor?.name}: ${(e as Error)?.message}`,
      );
    if (text && !(e as Error).message.includes(text))
      throw new Error(`message "${(e as Error).message}" lacks "${text}"`);
    return;
  }
  throw new Error(`expected ${type.name} to be thrown`);
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

const ISSUED = '0101010101/C/2020/01';

function detailRow(overrides: Record<string, unknown> = {}) {
  const now = new Date();
  return {
    id: 'center-new',
    districtId: 'district-1',
    villageId: 'village-1',
    code: ISSUED,
    legacyCode: null,
    ncdaTypeCode: 'C',
    startYear: 2020,
    codeIssuedAt: now,
    name: 'New Center',
    phone: null,
    capacity: null,
    latitude: null,
    longitude: null,
    status: EcdCenterStatus.active,
    facilityType: 'community_based',
    currentComplianceLevel: null,
    currentComplianceAssessedAt: null,
    createdAt: now,
    createdById: 'user-1',
    updatedAt: now,
    updatedById: 'user-1',
    deletedAt: null,
    version: 1,
    syncStatus: 'synced',
    lastModifiedByDeviceId: null,
    lastModifiedAt: now,
    district: { id: 'district-1', name: 'Nyarugenge', province: { name: 'Kigali' } },
    village: { id: 'village-1', name: 'Sani' },
    _count: { children: 0, userAccounts: 0 },
    ...overrides,
  };
}

/** Fake Prisma that records the issue call, the created row and audit/notification side effects. */
function harness(
  opts: {
    village?: { id: string; districtId: string | null; minalocCode: string | null } | null;
    issueError?: Error;
    existing?: Record<string, unknown> | null;
  } = {},
) {
  const calls = {
    raw: [] as Array<{ sql: string; values: unknown[] }>,
    created: null as Record<string, unknown> | null,
    classrooms: [] as unknown[],
    audits: [] as Array<Record<string, unknown>>,
    notifications: [] as unknown[],
    updateMany: null as Record<string, unknown> | null,
  };
  const village =
    opts.village === undefined
      ? { id: 'village-1', districtId: 'district-1', minalocCode: '0101010101' }
      : opts.village;
  const tx = {
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.raw.push({ sql: strings.join('?'), values });
      if (opts.issueError) throw opts.issueError;
      if (strings.join('?').includes('issue_ecd_code')) return [{ code: ISSUED }];
      return [{}];
    },
    ecdCenter: {
      create: async (args: { data: Record<string, unknown> }) => {
        calls.created = args.data;
        return { ...detailRow(), ...args.data };
      },
      updateMany: async (args: { data: Record<string, unknown> }) => {
        calls.updateMany = args.data;
        return { count: 1 };
      },
      findUniqueOrThrow: async () =>
        detailRow({ code: '0101010101/C/2020/09', legacyCode: 'OLD', version: 2 }),
      findFirst: async () => ({ version: 1 }),
    },
    classroom: {
      createMany: async (args: { data: unknown[] }) => {
        calls.classrooms = args.data;
        return { count: args.data.length };
      },
    },
  };
  const prisma = {
    administrativeUnit: { findFirst: async () => village },
    district: { findUnique: async () => ({ name: 'Nyarugenge' }) },
    ecdCenter: {
      findFirst: async (args: { select?: unknown }) => {
        if (opts.existing === null) return null;
        return args?.select
          ? { id: 'center-new', code: ISSUED, legacyCode: null, version: 1, ...opts.existing }
          : detailRow(opts.existing ?? {});
      },
    },
    attendanceRecord: { count: async () => 0 },
    referral: { count: async () => 0 },
    device: { findFirst: async () => null },
    $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
  };
  const audit = { log: async (ctx: Record<string, unknown>) => void calls.audits.push(ctx) };
  const notificationEvents = {
    onCenterCreated: async (input: unknown) => void calls.notifications.push(input),
  };
  const service = new CentersService(prisma as never, audit as never, notificationEvents as never);
  return { service, calls };
}

const createDto = {
  name: '  New Center ',
  villageId: 'village-1',
  ncdaTypeCode: 'C' as const,
  startYear: 2020,
};

const districtFocal = user({ role: UserRole.district_focal_person, districtId: 'district-1' });
const ncda = user({ role: UserRole.ncda_admin, id: 'ncda-1' });

async function main() {
  // ---- helpers ----
  await assert('pattern: accepts guideline example, rejects 8-digit legacy and bad letter', () => {
    eq(NCDA_ECD_CODE_PATTERN.test('0101010101/C/2020/07'), true);
    eq(NCDA_ECD_CODE_PATTERN.test('54050106/2021/01'), false, 'legacy');
    eq(NCDA_ECD_CODE_PATTERN.test('0101010101/F/2020/07'), false, 'letter F');
    eq(NCDA_ECD_CODE_PATTERN.test('0101010101/C/2020/7'), false, 'one-digit NN');
  });

  await assert('start year: 1950..current year only', () => {
    const now = new Date('2026-10-21T00:00:00Z');
    eq(isValidStartYear(1950, now), true);
    eq(isValidStartYear(2026, now), true);
    eq(isValidStartYear(1949, now), false);
    eq(isValidStartYear(2027, now), false);
    eq(isValidStartYear(2020.5, now), false);
  });

  await assert('type update: letter derives facilityType', () => {
    eq(resolveTypeUpdate({ ncdaTypeCode: null, facilityType: null }, { ncdaTypeCode: 'E' }), {
      ncdaTypeCode: 'E',
      facilityType: 'ecd_3_5',
    });
  });

  await assert('type update: conflicting explicit facilityType rejected', async () => {
    await rejects(
      async () =>
        resolveTypeUpdate(
          { ncdaTypeCode: null, facilityType: null },
          { ncdaTypeCode: 'A', facilityType: 'home_based' },
        ),
      BadRequestException,
    );
  });

  await assert(
    'type update: facilityType change on coded center must agree with letter',
    async () => {
      await rejects(
        async () =>
          resolveTypeUpdate(
            { ncdaTypeCode: 'B', facilityType: 'home_based' },
            { facilityType: 'daycare' },
          ),
        BadRequestException,
        'change ncdaTypeCode',
      );
      await rejects(
        async () =>
          resolveTypeUpdate(
            { ncdaTypeCode: 'B', facilityType: 'home_based' },
            { facilityType: null },
          ),
        BadRequestException,
      );
      eq(
        resolveTypeUpdate(
          { ncdaTypeCode: 'D', facilityType: 'ecd_3_5' },
          { facilityType: 'ecd_3_5' },
        ),
        {
          facilityType: 'ecd_3_5',
        },
      );
      eq(
        resolveTypeUpdate({ ncdaTypeCode: null, facilityType: null }, { facilityType: 'daycare' }),
        {
          facilityType: 'daycare',
        },
      );
    },
  );

  await assert('db error mapping: Prisma raw-query message → HTTP exception', () => {
    const prismaMsg = (body: string) =>
      new Error(
        `Invalid \`prisma.$queryRaw()\` invocation:\n\nRaw query failed. Code: \`P0001\`. Message: \`${body}\``,
      );
    const bad = mapEcdCodeDbError(
      prismaMsg('ECD_CODE_VILLAGE_NOT_CODED: village v1 has no MINALOC code'),
    );
    eq(bad instanceof BadRequestException, true, 'village → 400');
    eq(bad?.message, 'village v1 has no MINALOC code');
    eq(
      mapEcdCodeDbError(prismaMsg('ECD_CODE_SEQUENCE_EXHAUSTED: village x used all')) instanceof
        ConflictException,
      true,
    );
    eq(
      mapEcdCodeDbError(prismaMsg('ECD_CODE_ALREADY_ISSUED: y')) instanceof ConflictException,
      true,
    );
    eq(mapEcdCodeDbError(new Error('connection reset')), null, 'unrelated untouched');
  });

  // ---- create ----
  await assert(
    'create: issues code in DB, derives facilityType, seeds classrooms, audits, notifies',
    async () => {
      const { service, calls } = harness();
      const dto = await service.create(districtFocal, { ...createDto });
      const issue = calls.raw.find((r) => r.sql.includes('issue_ecd_code'))!;
      eq(issue.values.slice(1), ['village-1', 'C', 2020, 'user-1'], 'issue args');
      eq(issue.values[0], calls.created!.id, 'same center id issued and inserted');
      eq(calls.created!.code, ISSUED);
      eq(calls.created!.facilityType, 'community_based');
      eq(calls.created!.ncdaTypeCode, 'C');
      eq(calls.created!.startYear, 2020);
      eq(calls.created!.districtId, 'district-1', 'district from village');
      eq(calls.created!.name, 'New Center');
      eq(calls.classrooms.length, 3);
      eq(calls.audits[0].action, AuditAction.CREATE);
      eq(calls.notifications.length, 1);
      eq(dto.code, ISSUED);
    },
  );

  await assert(
    'create: client cannot supply code (DTO has no code; service ignores extras)',
    async () => {
      const { service, calls } = harness();
      await service.create(districtFocal, { ...createDto, code: 'HACKED' } as never);
      eq(calls.created!.code, ISSUED);
    },
  );

  await assert('create: caregiver and director forbidden', async () => {
    for (const role of [UserRole.caregiver, UserRole.ecd_director]) {
      const { service, calls } = harness();
      await rejects(
        () =>
          service.create(user({ role, centerId: 'c', districtId: 'district-1' }), { ...createDto }),
        ForbiddenException,
      );
      eq(calls.raw.length, 0, `${role} issued nothing`);
    }
  });

  await assert('create: district focal cannot register in another district', async () => {
    const { service, calls } = harness({
      village: { id: 'village-9', districtId: 'district-9', minalocCode: '0202020202' },
    });
    await rejects(
      () => service.create(districtFocal, { ...createDto, villageId: 'village-9' }),
      ForbiddenException,
    );
    eq(calls.raw.length, 0, 'no code issued');
  });

  // collectVillageIdsUnder walks sector → cells → villages via findUnique/findMany.
  const withSectorTree = (service: CentersService, villageIds: string[]) => {
    const units = (
      service as unknown as { prisma: { administrativeUnit: Record<string, unknown> } }
    ).prisma.administrativeUnit;
    units.findUnique = async () => ({ id: 'sector-x', level: 'sector' });
    units.findMany = async (args: { where: { parentId: { in: string[] } } }) =>
      args.where.parentId.in.includes('sector-x')
        ? [{ id: 'cell-x', level: 'cell' }]
        : args.where.parentId.in.includes('cell-x')
          ? villageIds.map((id) => ({ id, level: 'village' }))
          : [];
  };
  const sectorFocal = user({
    role: UserRole.sector_focal_person,
    districtId: 'district-1',
    sectorId: 'sector-x',
  });

  await assert('create: sector focal outside own sector forbidden', async () => {
    const { service, calls } = harness();
    withSectorTree(service, ['village-other']);
    await rejects(() => service.create(sectorFocal, { ...createDto }), ForbiddenException);
    eq(calls.raw.length, 0);
  });

  await assert('create: sector focal inside own sector allowed', async () => {
    const { service, calls } = harness();
    withSectorTree(service, ['village-1']);
    await service.create(sectorFocal, { ...createDto });
    eq(calls.created!.code, ISSUED);
  });

  await assert('create: village without MINALOC code rejected before issuing', async () => {
    const { service, calls } = harness({
      village: { id: 'village-1', districtId: 'district-1', minalocCode: null },
    });
    await rejects(
      () => service.create(districtFocal, { ...createDto }),
      BadRequestException,
      'MINALOC',
    );
    eq(calls.raw.length, 0);
  });

  await assert('create: future start year rejected', async () => {
    const { service } = harness();
    await rejects(
      () =>
        service.create(districtFocal, { ...createDto, startYear: new Date().getUTCFullYear() + 1 }),
      BadRequestException,
    );
  });

  await assert('create: DB sequence exhaustion → 409 and no center insert', async () => {
    const { service, calls } = harness({
      issueError: new Error(
        'Raw query failed. Code: `P0001`. Message: `ECD_CODE_SEQUENCE_EXHAUSTED: village 0101010101 has used all 99 facility numbers`',
      ),
    });
    await rejects(() => service.create(ncda, { ...createDto }), ConflictException, 'all 99');
    eq(calls.created, null);
  });

  // ---- override ----
  await assert('override: only NCDA admin', async () => {
    for (const u of [
      districtFocal,
      user({ role: UserRole.sector_focal_person, districtId: 'district-1', sectorId: 's' }),
    ]) {
      const { service, calls } = harness();
      await rejects(
        () =>
          service.overrideCode(u, 'center-new', {
            code: '0101010101/C/2020/09',
            reason: 'wrong village',
          }),
        ForbiddenException,
      );
      eq(calls.raw.length, 0);
    }
  });

  await assert('override: calls DB override and audits reason', async () => {
    const { service, calls } = harness();
    await service.overrideCode(ncda, 'center-new', {
      code: '0101010101/C/2020/09',
      reason: '  wrong village ',
    });
    const call = calls.raw.find((r) => r.sql.includes('override_ecd_code'))!;
    eq(call.values, ['center-new', '0101010101/C/2020/09', 'wrong village', 'ncda-1']);
    eq((calls.audits[0].metadata as Record<string, unknown>).operation, 'ecd_code_override');
    eq((calls.audits[0].metadata as Record<string, unknown>).reason, 'wrong village');
  });

  await assert('override: already-issued code → 409', async () => {
    const { service } = harness({
      issueError: new Error(
        'Message: `ECD_CODE_ALREADY_ISSUED: 0101010101/C/2020/01 has already been issued`',
      ),
    });
    await rejects(
      () => service.overrideCode(ncda, 'center-new', { code: ISSUED, reason: 'duplicate' }),
      ConflictException,
    );
  });

  // ---- update ----
  await assert(
    'update: setting ncdaTypeCode writes letter + facilityType, never code',
    async () => {
      const { service, calls } = harness({ existing: { ncdaTypeCode: null, facilityType: null } });
      await service.update(districtFocal, 'center-new', {
        version: 1,
        ncdaTypeCode: 'D',
        startYear: 2019,
      });
      eq(calls.updateMany!.ncdaTypeCode, 'D');
      eq(calls.updateMany!.facilityType, 'ecd_3_5');
      eq(calls.updateMany!.startYear, 2019);
      eq('code' in calls.updateMany!, false, 'code untouched');
    },
  );

  await assert('update: facilityType contradicting letter rejected before write', async () => {
    const { service, calls } = harness({
      existing: { ncdaTypeCode: 'B', facilityType: 'home_based' },
    });
    await rejects(
      () =>
        service.update(districtFocal, 'center-new', {
          version: 1,
          facilityType: 'daycare' as never,
        }),
      BadRequestException,
    );
    eq(calls.updateMany, null);
  });

  console.log('\nAll ECD code tests passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

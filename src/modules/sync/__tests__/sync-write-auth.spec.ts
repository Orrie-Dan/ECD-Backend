import { UserRole } from '../../../common/domain';
import { AuditAction } from '@prisma/client';
import { AuthUser } from '../../auth/interfaces/jwt-payload.interface';
import {
  AccessScope,
  CAREGIVER_FORBIDDEN_SYNC_ENTITY_TYPES,
  SyncAccessService,
} from '../sync-access.service';

/**
 * Sync write-authorization test cases.
 * Run: npx ts-node src/modules/sync/__tests__/sync-write-auth.spec.ts
 */

function createService(prisma: object): SyncAccessService {
  return new SyncAccessService(prisma as never);
}

function user(partial: Partial<AuthUser> & Pick<AuthUser, 'role'>): AuthUser {
  return {
    id: partial.id ?? 'user-1',
    username: partial.username ?? 'user',
    email: partial.email ?? null,
    fullName: partial.fullName ?? 'User',
    role: partial.role,
    centerId: partial.centerId ?? null,
    districtId: partial.districtId ?? null,
    status: partial.status ?? 'active',
  };
}

const emptyPrisma = {
  ecdCenter: { findMany: async () => [], findUnique: async () => null },
  administrativeUnit: {
    findFirst: async () => null,
  },
  child: { findUnique: async () => null },
  attendanceRecord: { findUnique: async () => null },
  washIndicator: { findUnique: async () => null },
  complianceAssessment: { findUnique: async () => null },
  childNutritionScreening: { findUnique: async () => null },
  complianceAssessmentItem: { findUnique: async () => null },
  childTransfer: { findUnique: async () => null },
  stedAssessment: { findUnique: async () => null },
  referral: { findUnique: async () => null },
  centerFeedingDay: { findUnique: async () => null },
  centerFeedingMonthSummary: { findUnique: async () => null },
};

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

  await assert('caregiver forbidden list includes ecd_center', () => {
    eq(CAREGIVER_FORBIDDEN_SYNC_ENTITY_TYPES.includes('ecd_center'), true);
  });

  const svc = createService(emptyPrisma);

  await assert('caregiver cannot write ecd_center (entity type)', () => {
    eq(svc.isEntityTypePermittedForRole(UserRole.caregiver, 'ecd_center'), false);
  });

  await assert('ecd_director cannot write ecd_center (entity type)', () => {
    eq(svc.isEntityTypePermittedForRole(UserRole.ecd_director, 'ecd_center'), false);
  });

  await assert('ecd_director can write child (entity type)', () => {
    eq(svc.isEntityTypePermittedForRole(UserRole.ecd_director, 'child'), true);
  });

  await assert('district_focal_person can write ecd_center (entity type)', () => {
    eq(svc.isEntityTypePermittedForRole(UserRole.district_focal_person, 'ecd_center'), true);
  });

  await assert('ecdCenterFilter: caregiver with districtId is own center only', () => {
    const scope: AccessScope = { centerIds: ['center-a'], districtId: 'd1' };
    const filter = svc.ecdCenterFilter(scope);
    if (JSON.stringify(filter) !== JSON.stringify({ id: { in: ['center-a'] } })) {
      throw new Error(`unexpected filter ${JSON.stringify(filter)}`);
    }
  });

  await assert('ecdCenterFilter: district focal uses assigned center ids', () => {
    const scope: AccessScope = {
      centerIds: ['c1', 'c2'],
      districtId: 'd1',
    };
    const filter = svc.ecdCenterFilter(scope);
    if (JSON.stringify(filter) !== JSON.stringify({ id: { in: ['c1', 'c2'] } })) {
      throw new Error(`unexpected filter ${JSON.stringify(filter)}`);
    }
  });

  await assert('ecdCenterFilter: ncda is unscoped', () => {
    const filter = svc.ecdCenterFilter({ centerIds: 'all', districtId: null });
    if (JSON.stringify(filter) !== '{}') {
      throw new Error(`unexpected filter ${JSON.stringify(filter)}`);
    }
  });

  await assert('isCenterInScope: caregiver own center', () => {
    const scope: AccessScope = { centerIds: ['center-a'], districtId: 'd1' };
    eq(svc.isCenterInScope(scope, 'center-a'), true);
  });

  await assert('isCenterInScope: caregiver other center', () => {
    const scope: AccessScope = { centerIds: ['center-a'], districtId: 'd1' };
    eq(svc.isCenterInScope(scope, 'center-b'), false);
  });

  await assert('caregiver writing own center child CREATE → pass', async () => {
    const childSvc = createService({
      ...emptyPrisma,
      administrativeUnit: {
        findFirst: async () => ({ id: 'village-1' }),
      },
    });
    const result = await childSvc.authorizeSyncWrite({
      user: user({ role: UserRole.caregiver, centerId: 'center-a' }),
      scope: { centerIds: ['center-a'], districtId: 'd1' },
      entityType: 'child',
      entityId: 'child-1',
      operation: AuditAction.create,
      payload: { centerId: 'center-a', homeVillageId: 'village-1' },
    });
    eq(result.allowed, true);
  });

  await assert('child CREATE without homeVillageId → reject', async () => {
    const result = await svc.authorizeSyncWrite({
      user: user({ role: UserRole.caregiver, centerId: 'center-a' }),
      scope: { centerIds: ['center-a'], districtId: 'd1' },
      entityType: 'child',
      entityId: 'child-1',
      operation: AuditAction.create,
      payload: { centerId: 'center-a' },
    });
    eq(result.allowed, false);
    if (!result.allowed) eq(result.reason, 'homeVillageId is required');
  });

  await assert('child CREATE with unknown homeVillageId → reject', async () => {
    const result = await svc.authorizeSyncWrite({
      user: user({ role: UserRole.caregiver, centerId: 'center-a' }),
      scope: { centerIds: ['center-a'], districtId: 'd1' },
      entityType: 'child',
      entityId: 'child-1',
      operation: AuditAction.create,
      payload: { centerId: 'center-a', homeVillageId: 'missing-village' },
    });
    eq(result.allowed, false);
    if (!result.allowed) {
      eq(result.reason, 'homeVillageId does not reference an existing village');
    }
  });

  await assert(
    'caregiver writing other center child CREATE → reject center out of scope',
    async () => {
      const result = await svc.authorizeSyncWrite({
        user: user({ role: UserRole.caregiver, centerId: 'center-a' }),
        scope: { centerIds: ['center-a'], districtId: 'd1' },
        entityType: 'child',
        entityId: 'child-1',
        operation: AuditAction.create,
        payload: { centerId: 'center-b' },
      });
      eq(result.allowed, false);
      if (!result.allowed) eq(result.reason, 'center out of scope');
    },
  );

  await assert('caregiver writing ecd_center → reject entity type not permitted', async () => {
    const result = await svc.authorizeSyncWrite({
      user: user({ role: UserRole.caregiver, centerId: 'center-a' }),
      scope: { centerIds: ['center-a'], districtId: 'd1' },
      entityType: 'ecd_center',
      entityId: 'center-a',
      operation: AuditAction.update,
      payload: { name: 'X' },
    });
    eq(result.allowed, false);
    if (!result.allowed) eq(result.reason, 'entity type not permitted for role');
  });

  await assert('district_focal_person writing center in own district → pass', async () => {
    const districtSvc = createService({
      ...emptyPrisma,
      ecdCenter: {
        findMany: async () => [{ id: 'center-a' }, { id: 'center-b' }],
        findUnique: async () => ({
          id: 'center-a',
          districtId: 'district-1',
        }),
      },
    });

    const result = await districtSvc.authorizeSyncWrite({
      user: user({
        role: UserRole.district_focal_person,
        districtId: 'district-1',
      }),
      scope: {
        centerIds: ['center-a', 'center-b'],
        districtId: 'district-1',
      },
      entityType: 'ecd_center',
      entityId: 'center-a',
      operation: AuditAction.update,
      payload: { name: 'Updated' },
    });
    eq(result.allowed, true);
  });

  await assert('district_focal_person writing center outside district → reject', async () => {
    const districtSvc = createService({
      ...emptyPrisma,
      ecdCenter: {
        findMany: async () => [{ id: 'center-a' }],
        findUnique: async () => ({
          id: 'center-x',
          districtId: 'district-other',
        }),
      },
    });

    const result = await districtSvc.authorizeSyncWrite({
      user: user({
        role: UserRole.district_focal_person,
        districtId: 'district-1',
      }),
      scope: { centerIds: ['center-a'], districtId: 'district-1' },
      entityType: 'ecd_center',
      entityId: 'center-x',
      operation: AuditAction.update,
      payload: { name: 'Updated' },
    });
    eq(result.allowed, false);
    if (!result.allowed) eq(result.reason, 'center out of scope');
  });

  await assert('ncda_admin unrestricted → pass for ecd_center', async () => {
    const result = await svc.authorizeSyncWrite({
      user: user({ role: UserRole.ncda_admin }),
      scope: { centerIds: 'all', districtId: null },
      entityType: 'ecd_center',
      entityId: 'any',
      operation: AuditAction.create,
      payload: { districtId: 'anywhere' },
    });
    eq(result.allowed, true);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

import { UserRole } from '@prisma/client';
import { AuthUser } from '../../auth/interfaces/jwt-payload.interface';
import { UsersService } from '../users.service';

/**
 * User creation / password-reset authorization matrix tests.
 * Run: npx ts-node src/modules/users/tests/user.authorization.spec.ts
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

function createService(): UsersService {
  // Authorization helpers do not touch prisma/auth/config.
  const mockNotifications = {
    findUserIdsByRoleAndCenter: async () => [],
    findUserIdsByRoleAndDistrict: async () => [],
    notifyAsync: () => {},
    create: async () => ({}),
    createForMultipleUsers: async () => 0,
  } as any;
  return new UsersService({} as never, {} as never, {} as never, mockNotifications);
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

  const svc = createService();

  const ncda = user({ role: UserRole.ncda_admin, id: 'ncda-1' });
  const focal = user({
    role: UserRole.district_focal_person,
    id: 'focal-1',
    districtId: 'd1',
  });
  const caregiver = user({
    role: UserRole.caregiver,
    id: 'cg-1',
    centerId: 'c1',
    districtId: 'd1',
  });
  const director = user({
    role: UserRole.ecd_director,
    id: 'dir-1',
    centerId: 'c1',
    districtId: 'd1',
  });

  await assert('NCDA can create district officer', () => {
    eq(svc.canCreateRole(ncda, UserRole.district_focal_person), true);
  });

  await assert('NCDA can create ECD director', () => {
    eq(svc.canCreateRole(ncda, UserRole.ecd_director), true);
  });

  await assert('NCDA can create caregiver', () => {
    eq(svc.canCreateRole(ncda, UserRole.caregiver), true);
  });

  await assert('NCDA cannot create ncda_admin (no escalation)', () => {
    eq(svc.canCreateRole(ncda, UserRole.ncda_admin), false);
  });

  await assert('District officer can create ECD director', () => {
    eq(svc.canCreateRole(focal, UserRole.ecd_director), true);
  });

  await assert('District officer can create caregiver', () => {
    eq(svc.canCreateRole(focal, UserRole.caregiver), true);
  });

  await assert('District officer cannot create another district officer', () => {
    eq(svc.canCreateRole(focal, UserRole.district_focal_person), false);
  });

  await assert('District officer cannot create ncda_admin', () => {
    eq(svc.canCreateRole(focal, UserRole.ncda_admin), false);
  });

  await assert('ECD director can create caregiver', () => {
    eq(svc.canCreateRole(director, UserRole.caregiver), true);
  });

  await assert('ECD director cannot create another ECD director', () => {
    eq(svc.canCreateRole(director, UserRole.ecd_director), false);
  });

  await assert('ECD director cannot create district officer or admin', () => {
    eq(svc.canCreateRole(director, UserRole.district_focal_person), false);
    eq(svc.canCreateRole(director, UserRole.ncda_admin), false);
  });

  await assert('Caregiver cannot create users', () => {
    eq(svc.canCreateRole(caregiver, UserRole.caregiver), false);
    eq(svc.canCreateRole(caregiver, UserRole.ecd_director), false);
    eq(svc.canCreateRole(caregiver, UserRole.district_focal_person), false);
    eq(svc.canCreateRole(caregiver, UserRole.ncda_admin), false);
  });

  await assert('NCDA can reset any user password', () => {
    eq(
      svc.canResetPassword(ncda, {
        role: UserRole.caregiver,
        districtId: 'd9',
        centerId: 'c9',
      }),
      true,
    );
    eq(
      svc.canResetPassword(ncda, {
        role: UserRole.district_focal_person,
        districtId: 'd1',
        centerId: null,
      }),
      true,
    );
    eq(
      svc.canResetPassword(ncda, {
        role: UserRole.ecd_director,
        districtId: 'd1',
        centerId: 'c1',
      }),
      true,
    );
  });

  await assert('District officer can reset caregiver in district', () => {
    eq(
      svc.canResetPassword(focal, {
        role: UserRole.caregiver,
        districtId: 'd1',
        centerId: 'c1',
      }),
      true,
    );
  });

  await assert('District officer can reset ECD director in district', () => {
    eq(
      svc.canResetPassword(focal, {
        role: UserRole.ecd_director,
        districtId: 'd1',
        centerId: 'c1',
      }),
      true,
    );
  });

  await assert('District officer cannot reset caregiver outside district', () => {
    eq(
      svc.canResetPassword(focal, {
        role: UserRole.caregiver,
        districtId: 'd2',
        centerId: 'c2',
      }),
      false,
    );
  });

  await assert('District officer cannot reset another district officer', () => {
    eq(
      svc.canResetPassword(focal, {
        role: UserRole.district_focal_person,
        districtId: 'd1',
        centerId: null,
      }),
      false,
    );
  });

  await assert('ECD director can reset caregiver at same center', () => {
    eq(
      svc.canResetPassword(director, {
        role: UserRole.caregiver,
        districtId: 'd1',
        centerId: 'c1',
      }),
      true,
    );
  });

  await assert('ECD director cannot reset caregiver at another center', () => {
    eq(
      svc.canResetPassword(director, {
        role: UserRole.caregiver,
        districtId: 'd1',
        centerId: 'c2',
      }),
      false,
    );
  });

  await assert('ECD director cannot reset another ECD director', () => {
    eq(
      svc.canResetPassword(director, {
        role: UserRole.ecd_director,
        districtId: 'd1',
        centerId: 'c1',
      }),
      false,
    );
  });

  await assert('Caregiver cannot reset passwords', () => {
    eq(
      svc.canResetPassword(caregiver, {
        role: UserRole.caregiver,
        districtId: 'd1',
        centerId: 'c1',
      }),
      false,
    );
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

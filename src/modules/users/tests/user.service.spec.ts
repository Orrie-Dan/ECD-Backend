import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserAccountStatus, UserRole } from '@prisma/client';
import { AuthService } from '../../auth/auth.service';
import { AuthUser } from '../../auth/interfaces/jwt-payload.interface';
import { CreateUserDto } from '../dto/create-user.dto';
import { UsersService } from '../users.service';

/**
 * Users service tests (mocked Prisma / Auth).
 * Run: npx ts-node src/modules/users/tests/user.service.spec.ts
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

function createService(prisma: object, auth?: Partial<AuthService>) {
  const authService = {
    hashPassword: async (plain: string) => `hashed:${plain}`,
    ...auth,
  } as AuthService;

  const config = {
    get: (key: string) => (key === 'NODE_ENV' ? 'test' : undefined),
  } as ConfigService;

  return new UsersService(prisma as never, authService, config);
}

function createdUserRow(data: Record<string, unknown>) {
  const now = new Date();
  return {
    id: 'new-user-id',
    username: data.username,
    passwordHash: data.passwordHash,
    fullName: data.fullName,
    phone: data.phone ?? null,
    email: null,
    role: data.role,
    districtId: data.districtId ?? null,
    centerId: data.centerId ?? null,
    status: UserAccountStatus.active,
    lastLoginAt: null,
    failedLoginAttempts: 0,
    lockedUntil: null,
    passwordChangedAt: null,
    createdAt: now,
    createdById: data.createdById,
    updatedAt: now,
    updatedById: data.updatedById,
    district: data.districtId
      ? { id: data.districtId, name: 'District' }
      : null,
    center: data.centerId
      ? { id: data.centerId, code: 'C1', name: 'Center' }
      : null,
    createdBy: {
      id: data.createdById,
      username: 'actor',
      fullName: 'Actor',
    },
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
      throw new Error(
        `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
      );
    }
  };

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

  await assert('NCDA creates district officer', async () => {
    const creates: Record<string, unknown>[] = [];
    const prisma = {
      userAccount: {
        findUnique: async () => null,
        create: async ({ data }: { data: Record<string, unknown> }) => {
          creates.push(data);
          return createdUserRow(data);
        },
      },
      district: {
        findUnique: async () => ({ id: 'd1' }),
      },
      passwordResetToken: {
        create: async () => ({}),
      },
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          userAccount: {
            create: async ({ data }: { data: Record<string, unknown> }) => {
              creates.push(data);
              return createdUserRow(data);
            },
          },
          passwordResetToken: {
            create: async () => ({}),
          },
        }),
    };

    const svc = createService(prisma);
    const dto: CreateUserDto = {
      username: 'focal_kigali',
      fullName: 'Focal Person',
      role: UserRole.district_focal_person,
      districtId: 'd1',
    };

    const result = await svc.create(ncda, dto);
    eq(creates.length, 1);
    eq(creates[0].role, UserRole.district_focal_person);
    eq(creates[0].districtId, 'd1');
    eq(creates[0].centerId, null);
    eq(creates[0].createdById, 'ncda-1');
    eq(result.role, UserRole.district_focal_person);
    eq(result.status, 'ACTIVE');
    eq('passwordHash' in result, false);
    eq(typeof result.temporaryPassword, 'string');
    eq(result.temporaryPassword.length, 10);
    eq(result.mustChangePassword, true);
    eq(typeof creates[0].passwordHash, 'string');
    eq(String(creates[0].passwordHash).startsWith('hashed:'), true);
    eq(creates[0].passwordHash, `hashed:${result.temporaryPassword}`);
  });

  await assert('NCDA creates caregiver (district derived from center)', async () => {
    const creates: Record<string, unknown>[] = [];
    const prisma = {
      userAccount: {
        findUnique: async () => null,
      },
      ecdCenter: {
        findFirst: async () => ({ id: 'c1', districtId: 'd1' }),
      },
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          userAccount: {
            create: async ({ data }: { data: Record<string, unknown> }) => {
              creates.push(data);
              return createdUserRow(data);
            },
          },
          passwordResetToken: {
            create: async () => ({}),
          },
        }),
    };

    const svc = createService(prisma);
    const result = await svc.create(ncda, {
      username: 'cg_one',
      fullName: 'Care One',
      role: UserRole.caregiver,
      centerId: 'c1',
    });

    eq(creates[0].role, UserRole.caregiver);
    eq(creates[0].centerId, 'c1');
    eq(creates[0].districtId, 'd1');
    eq(result.center?.id, 'c1');
  });

  await assert('District officer creates caregiver in district', async () => {
    const creates: Record<string, unknown>[] = [];
    const prisma = {
      userAccount: { findUnique: async () => null },
      ecdCenter: {
        findFirst: async () => ({ id: 'c1', districtId: 'd1' }),
      },
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          userAccount: {
            create: async ({ data }: { data: Record<string, unknown> }) => {
              creates.push(data);
              return createdUserRow(data);
            },
          },
          passwordResetToken: { create: async () => ({}) },
        }),
    };

    const svc = createService(prisma);
    await svc.create(focal, {
      username: 'cg_two',
      fullName: 'Care Two',
      role: UserRole.caregiver,
      centerId: 'c1',
    });
    eq(creates[0].createdById, 'focal-1');
    eq(creates[0].districtId, 'd1');
  });

  await assert('District officer cannot create another district officer', async () => {
    const svc = createService({
      userAccount: { findUnique: async () => null },
    });

    let caught: unknown;
    try {
      await svc.create(focal, {
        username: 'focal2',
        fullName: 'Other Focal',
        role: UserRole.district_focal_person,
        districtId: 'd1',
      });
    } catch (err) {
      caught = err;
    }
    eq(caught instanceof ForbiddenException, true);
  });

  await assert('District officer cannot create caregiver outside district', async () => {
    const prisma = {
      userAccount: { findUnique: async () => null },
      ecdCenter: {
        findFirst: async () => ({ id: 'c-other', districtId: 'd2' }),
      },
    };
    const svc = createService(prisma);

    let caught: unknown;
    try {
      await svc.create(focal, {
        username: 'cg_out',
        fullName: 'Outsider',
        role: UserRole.caregiver,
        centerId: 'c-other',
      });
    } catch (err) {
      caught = err;
    }
    eq(caught instanceof ForbiddenException, true);
  });

  await assert('Caregiver cannot create users', async () => {
    const svc = createService({});
    let caught: unknown;
    try {
      await svc.create(caregiver, {
        username: 'x',
        fullName: 'X',
        role: UserRole.caregiver,
        centerId: 'c1',
      });
    } catch (err) {
      caught = err;
    }
    eq(caught instanceof ForbiddenException, true);
  });

  await assert('duplicate username rejected', async () => {
    const prisma = {
      userAccount: {
        findUnique: async () => ({ id: 'existing' }),
      },
      district: { findUnique: async () => ({ id: 'd1' }) },
    };
    const svc = createService(prisma);
    let caught: unknown;
    try {
      await svc.create(ncda, {
        username: 'taken',
        fullName: 'Taken',
        role: UserRole.district_focal_person,
        districtId: 'd1',
      });
    } catch (err) {
      caught = err;
    }
    eq(caught instanceof ConflictException, true);
  });

  await assert('password reset permission enforced for district officer', async () => {
    const prisma = {
      userAccount: {
        findUnique: async ({ where }: { where: { id: string } }) => {
          if (where.id === 'cg-out') {
            return {
              id: 'cg-out',
              username: 'out',
              passwordHash: 'x',
              fullName: 'Out',
              phone: null,
              email: null,
              role: UserRole.caregiver,
              districtId: 'd2',
              centerId: 'c2',
              status: UserAccountStatus.active,
              lastLoginAt: null,
              failedLoginAttempts: 0,
              lockedUntil: null,
              passwordChangedAt: null,
              createdAt: new Date(),
              createdById: null,
              updatedAt: new Date(),
              updatedById: null,
              district: { id: 'd2', name: 'Other' },
              center: { id: 'c2', code: 'C2', name: 'Other Center' },
              createdBy: null,
            };
          }
          return null;
        },
      },
    };
    const svc = createService(prisma);

    let caught: unknown;
    try {
      await svc.resetPassword(focal, 'cg-out', {});
    } catch (err) {
      caught = err;
    }
    // Outside district → not visible → Forbidden
    eq(caught instanceof ForbiddenException, true);
  });

  await assert('NCDA password reset succeeds', async () => {
    const updates: unknown[] = [];
    const tokens: unknown[] = [];
    const target = {
      id: 'cg-1',
      username: 'cg',
      passwordHash: 'old',
      fullName: 'Care',
      phone: null,
      email: null,
      role: UserRole.caregiver,
      districtId: 'd1',
      centerId: 'c1',
      status: UserAccountStatus.active,
      lastLoginAt: null,
      failedLoginAttempts: 2,
      lockedUntil: null,
      passwordChangedAt: null,
      createdAt: new Date(),
      createdById: null,
      updatedAt: new Date(),
      updatedById: null,
      district: { id: 'd1', name: 'D' },
      center: { id: 'c1', code: 'C1', name: 'Center' },
      createdBy: null,
    };

    const prisma = {
      userAccount: {
        findUnique: async () => target,
        update: async (args: unknown) => {
          updates.push(args);
          return target;
        },
      },
      passwordResetToken: {
        create: async (args: unknown) => {
          tokens.push(args);
          return {};
        },
      },
      $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
    };

    const svc = createService(prisma);
    const result = await svc.resetPassword(ncda, 'cg-1', {
      newPassword: 'NewPass123!',
    });
    eq(result.success, true);
    eq(result.mustChangePassword, false);
    eq(result.temporaryPassword, undefined);
    eq(updates.length, 1);
    eq(tokens.length, 1);
    const updateArgs = updates[0] as {
      data: { passwordChangedAt: Date | null; passwordHash: string };
    };
    eq(updateArgs.data.passwordHash, 'hashed:NewPass123!');
    eq(updateArgs.data.passwordChangedAt instanceof Date, true);
  });

  await assert('NCDA password reset without newPassword returns temporaryPassword', async () => {
    const updates: unknown[] = [];
    const target = {
      id: 'cg-1',
      username: 'cg',
      passwordHash: 'old',
      fullName: 'Care',
      phone: null,
      email: null,
      role: UserRole.caregiver,
      districtId: 'd1',
      centerId: 'c1',
      status: UserAccountStatus.active,
      lastLoginAt: null,
      failedLoginAttempts: 0,
      lockedUntil: null,
      passwordChangedAt: new Date(),
      createdAt: new Date(),
      createdById: null,
      updatedAt: new Date(),
      updatedById: null,
      district: { id: 'd1', name: 'D' },
      center: { id: 'c1', code: 'C1', name: 'Center' },
      createdBy: null,
    };

    const prisma = {
      userAccount: {
        findUnique: async () => target,
        update: async (args: unknown) => {
          updates.push(args);
          return target;
        },
      },
      passwordResetToken: {
        create: async () => ({}),
      },
      $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
    };

    const svc = createService(prisma);
    const result = await svc.resetPassword(ncda, 'cg-1', {});
    eq(result.success, true);
    eq(result.mustChangePassword, true);
    eq(typeof result.temporaryPassword, 'string');
    eq(result.temporaryPassword!.length, 10);
    const updateArgs = updates[0] as {
      data: { passwordChangedAt: Date | null; passwordHash: string };
    };
    eq(updateArgs.data.passwordChangedAt, null);
    eq(updateArgs.data.passwordHash, `hashed:${result.temporaryPassword}`);
  });

  await assert('missing center for caregiver create fails', async () => {
    const prisma = {
      userAccount: { findUnique: async () => null },
      ecdCenter: { findFirst: async () => null },
    };
    const svc = createService(prisma);
    let caught: unknown;
    try {
      await svc.create(ncda, {
        username: 'cg_missing',
        fullName: 'Missing',
        role: UserRole.caregiver,
        centerId: 'missing',
      });
    } catch (err) {
      caught = err;
    }
    eq(caught instanceof NotFoundException, true);
  });

  await assert('list users returns data + items + totalPages (additive)', async () => {
    const now = new Date();
    const row = {
      id: 'u1',
      username: 'cg1',
      fullName: 'Caregiver One',
      phone: null,
      role: UserRole.caregiver,
      status: UserAccountStatus.active,
      districtId: 'd1',
      centerId: 'c1',
      createdAt: now,
      updatedAt: now,
      createdById: null,
      district: { id: 'd1', name: 'Gasabo' },
      center: { id: 'c1', code: 'C1', name: 'Center' },
      createdBy: null,
    };
    const prisma = {
      $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
      userAccount: {
        findMany: async () => [row],
        count: async () => 25,
      },
    };
    const svc = createService(prisma);
    const result = await svc.findAll(ncda, { page: 2, pageSize: 10 });
    eq(Array.isArray(result.data), true);
    eq(Array.isArray(result.items), true);
    eq(result.data.length, 1);
    eq(result.items.length, 1);
    eq(result.items[0].id, result.data[0].id);
    eq(result.total, 25);
    eq(result.page, 2);
    eq(result.pageSize, 10);
    eq(result.totalPages, 3);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

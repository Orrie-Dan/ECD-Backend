/**
 * Settings module tests.
 * Run: npx ts-node src/modules/settings/__tests__/settings.service.spec.ts
 */
import { UserRole } from '../../../common/domain';
import { ForbiddenException } from '@nestjs/common';
import { AuthUser } from '../../auth/interfaces/jwt-payload.interface';
import { SettingsService } from '../settings.service';

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

function settingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'setting-1',
    districtId: 'district-1',
    key: 'alert_threshold',
    value: '10',
    updatedAt: new Date(),
    updatedById: 'user-1',
    ...overrides,
  };
}

async function main() {
  await assert('list: district focal scoped to own district', async () => {
    const captured: { where?: unknown } = {};
    const prisma = {
      appSetting: {
        findMany: async (args: { where: { districtId: string } }) => {
          captured.where = args.where;
          return [settingRow()];
        },
      },
    };
    const audit = { log: async () => undefined };
    const service = new SettingsService(prisma as never, audit as never);

    const result = await service.findAll(
      user({ role: UserRole.district_focal_person, districtId: 'district-1' }),
      {},
    );

    eq(result.length, 1);
    eq((captured.where as { districtId: string }).districtId, 'district-1');
  });

  await assert('list: district focal denied other district', async () => {
    const prisma = {
      appSetting: { findMany: async () => [] },
    };
    const service = new SettingsService(prisma as never, { log: async () => undefined } as never);

    let threw = false;
    try {
      await service.findAll(
        user({ role: UserRole.district_focal_person, districtId: 'district-1' }),
        { districtId: 'other-district' },
      );
    } catch (e) {
      threw = e instanceof ForbiddenException;
    }
    eq(threw, true);
  });

  await assert('upsert: creates new setting with audit', async () => {
    const auditLogs: unknown[] = [];
    const prisma = {
      appSetting: {
        findUnique: async () => null,
        upsert: async (args: { create: unknown }) =>
          settingRow(args.create as Record<string, unknown>),
      },
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = { appSetting: prisma.appSetting };
        return fn(tx);
      },
    };
    const audit = {
      log: async (args: unknown) => {
        auditLogs.push(args);
      },
    };
    const service = new SettingsService(prisma as never, audit as never);

    const result = await service.upsert(user({ role: UserRole.ncda_admin }), {
      districtId: 'district-1',
      key: 'new_key',
      value: '42',
    });

    eq(result.key, 'new_key');
    eq(result.value, '42');
    eq(auditLogs.length >= 1, true);
  });

  await assert('upsert: updates existing setting with audit', async () => {
    const auditLogs: unknown[] = [];
    const existing = settingRow({ value: 'old' });
    const prisma = {
      appSetting: {
        findUnique: async () => existing,
        upsert: async () => settingRow({ value: 'new' }),
      },
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = { appSetting: prisma.appSetting };
        return fn(tx);
      },
    };
    const audit = {
      log: async (args: unknown) => {
        auditLogs.push(args);
      },
    };
    const service = new SettingsService(prisma as never, audit as never);

    await service.upsert(user({ role: UserRole.district_focal_person, districtId: 'district-1' }), {
      districtId: 'district-1',
      key: 'alert_threshold',
      value: 'new',
    });

    eq(auditLogs.length >= 1, true);
  });

  console.log('\nAll settings tests passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

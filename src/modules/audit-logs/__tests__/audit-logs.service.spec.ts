/**
 * Audit logs module tests.
 * Run: npx ts-node src/modules/audit-logs/__tests__/audit-logs.service.spec.ts
 */
import { UserRole } from '../../../common/domain';
import { AuditAction } from '@prisma/client';
import { AuthUser } from '../../auth/interfaces/jwt-payload.interface';
import { AuditLogsService } from '../audit-logs.service';

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

function auditLogRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'log-1',
    entityType: 'ecd_center',
    entityId: 'center-1',
    action: AuditAction.update,
    changedById: 'user-1',
    changedAt: new Date(),
    oldValues: { name: 'Old' },
    newValues: { name: 'New' },
    metadata: { source: 'rest' },
    changedBy: { id: 'user-1', username: 'admin', fullName: 'Admin', districtId: 'district-1' },
    ...overrides,
  };
}

async function main() {
  await assert('list: ncda sees all logs', async () => {
    const captured: { where?: unknown } = {};
    const prisma = {
      $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
      auditLog: {
        findMany: async (args: { where: unknown }) => {
          captured.where = args.where;
          return [auditLogRow()];
        },
        count: async () => 1,
      },
    };
    const service = new AuditLogsService(prisma as never);

    const result = await service.findAll(user({ role: UserRole.ncda_admin }), {
      page: 1,
      pageSize: 20,
    });

    eq(result.total, 1);
    eq(result.items[0].entityType, 'ecd_center');
    eq(
      (captured.where as Record<string, unknown>).changedBy,
      undefined,
      'no district filter for ncda',
    );
  });

  await assert('list: district focal only sees district logs', async () => {
    const captured: { where?: Record<string, unknown> } = {};
    const prisma = {
      $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
      auditLog: {
        findMany: async (args: { where: Record<string, unknown> }) => {
          captured.where = args.where;
          return [auditLogRow()];
        },
        count: async () => 1,
      },
    };
    const service = new AuditLogsService(prisma as never);

    await service.findAll(
      user({ role: UserRole.district_focal_person, districtId: 'district-1' }),
      {},
    );

    eq((captured.where!.changedBy as { districtId: string }).districtId, 'district-1');
  });

  await assert('list: filters by entityType, action, userId', async () => {
    const captured: { where?: Record<string, unknown> } = {};
    const prisma = {
      $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
      auditLog: {
        findMany: async (args: { where: Record<string, unknown> }) => {
          captured.where = args.where;
          return [];
        },
        count: async () => 0,
      },
    };
    const service = new AuditLogsService(prisma as never);

    await service.findAll(user({ role: UserRole.ncda_admin }), {
      entityType: 'child',
      entityId: 'child-1',
      action: AuditAction.create,
      userId: 'user-x',
      from: '2026-01-01',
      to: '2026-01-31',
    });

    eq(captured.where!.entityType, 'child');
    eq(captured.where!.entityId, 'child-1');
    eq(captured.where!.action, AuditAction.create);
    eq(captured.where!.changedById, 'user-x');
    eq(typeof captured.where!.changedAt, 'object', 'date range filter');
  });

  console.log('\nAll audit-logs tests passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

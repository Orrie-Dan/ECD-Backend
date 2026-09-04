import { AbsentReason, AttendanceStatus, UserRole } from '../../../common/domain';
import { ForbiddenException } from '@nestjs/common';
import { canAccessCenter } from '../../../common/auth/scope.util';
import { AuthUser } from '../../auth/interfaces/jwt-payload.interface';
import { SyncAccessService } from '../../sync/sync-access.service';
import { AttendanceBatchDto } from '../dto/attendance-batch.dto';
import { AttendanceService } from '../attendance.service';

/**
 * Attendance service tests (mocked Prisma).
 * Run: npx ts-node src/modules/attendance/__tests__/attendance.service.spec.ts
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

function createService(prisma: object) {
  const syncAccess = {
    resolveScope: async (u: AuthUser) => {
      if (u.role === UserRole.ncda_admin) {
        return { centerIds: 'all' as const, districtId: null };
      }
      if (u.role === UserRole.district_focal_person) {
        return {
          centerIds: ['center-a'],
          districtId: u.districtId,
        };
      }
      return { centerIds: [u.centerId!], districtId: u.districtId };
    },
    centerFilter: (scope: { centerIds: string[] | 'all' }) => {
      if (scope.centerIds === 'all') return {};
      return { centerId: { in: scope.centerIds } };
    },
  } as SyncAccessService;

  return new AttendanceService(prisma as never, syncAccess, {
    log: async () => {},
  } as never);
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

  await assert('batch create new records', async () => {
    const creates: unknown[] = [];
    const prisma = {
      child: {
        findMany: async () => [
          {
            id: 'child-1',
            centerId: 'center-a',
            center: { id: 'center-a', districtId: 'd1' },
          },
        ],
      },
      attendanceRecord: {
        findMany: async () => [],
        create: async ({ data }: { data: Record<string, unknown> }) => {
          creates.push(data);
          return {
            ...data,
            createdAt: new Date(),
            updatedAt: new Date(),
            deletedAt: null,
            absentReason: data.absentReason ?? null,
            notes: data.notes ?? null,
          };
        },
      },
      syncOperation: { create: async () => ({}) },
      auditLog: { create: async () => ({}) },
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          attendanceRecord: {
            create: async ({ data }: { data: Record<string, unknown> }) => {
              creates.push(data);
              return {
                ...data,
                createdAt: new Date(),
                updatedAt: new Date(),
                deletedAt: null,
                absentReason: data.absentReason ?? null,
                notes: data.notes ?? null,
              };
            },
          },
          syncOperation: { create: async () => ({}) },
          auditLog: { create: async () => ({}) },
        }),
    };

    const svc = createService(prisma);
    const dto: AttendanceBatchDto = {
      records: [
        {
          childId: 'child-1',
          date: '2026-08-01',
          present: true,
        },
      ],
    };

    const result = await svc.createBatch(caregiver, dto);
    eq(result.created, 1);
    eq(result.updated, 0);
    eq(result.failed, 0);
    eq(result.items[0].outcome, 'created');
    eq(result.items[0].attendance?.present, true);
    eq((creates[0] as { status: string }).status, AttendanceStatus.present);
  });

  await assert('batch upsert updates existing records', async () => {
    const updates: unknown[] = [];
    const existing = {
      id: 'att-1',
      childId: 'child-1',
      centerId: 'center-a',
      attendanceDate: new Date('2026-08-01T00:00:00.000Z'),
      status: AttendanceStatus.present,
      absentReason: null,
      notes: null,
      recordedById: 'cg-1',
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    };

    const prisma = {
      child: {
        findMany: async () => [
          {
            id: 'child-1',
            centerId: 'center-a',
            center: { id: 'center-a', districtId: 'd1' },
          },
        ],
      },
      attendanceRecord: {
        findMany: async () => [existing],
      },
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          attendanceRecord: {
            updateMany: async ({
              where,
              data,
            }: {
              where: { id: string; version: number };
              data: Record<string, unknown>;
            }) => {
              updates.push({ where, data });
              eq(where.version, 1);
              return { count: 1 };
            },
            findFirstOrThrow: async () => ({
              ...existing,
              status: AttendanceStatus.absent,
              absentReason: AbsentReason.weather,
              version: 2,
              updatedAt: new Date(),
            }),
            findUnique: async () => ({ version: 2 }),
          },
          syncOperation: { create: async () => ({}) },
          auditLog: { create: async () => ({}) },
        }),
    };

    const svc = createService(prisma);
    const result = await svc.createBatch(caregiver, {
      records: [
        {
          childId: 'child-1',
          date: '2026-08-01',
          present: false,
          absentReason: AbsentReason.weather,
          version: 1,
        },
      ],
    });

    eq(result.created, 0);
    eq(result.updated, 1);
    eq(result.failed, 0);
    eq(result.items[0].outcome, 'updated');
    eq(result.items[0].attendance?.present, false);
    eq(result.items[0].attendance?.absentReason, AbsentReason.weather);
    eq((updates[0] as { data: { status: string } }).data.status, AttendanceStatus.absent);
  });

  await assert('batch upsert conflicts on stale version', async () => {
    const existing = {
      id: 'att-1',
      childId: 'child-1',
      centerId: 'center-a',
      attendanceDate: new Date('2026-08-01T00:00:00.000Z'),
      status: AttendanceStatus.present,
      absentReason: null,
      notes: null,
      recordedById: 'cg-1',
      version: 6,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    };

    const prisma = {
      child: {
        findMany: async () => [
          {
            id: 'child-1',
            centerId: 'center-a',
            center: { id: 'center-a', districtId: 'd1' },
          },
        ],
      },
      attendanceRecord: {
        findMany: async () => [existing],
      },
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          attendanceRecord: {
            updateMany: async () => ({ count: 0 }),
            findUnique: async () => ({ version: 6 }),
          },
          syncOperation: { create: async () => ({}) },
          auditLog: { create: async () => ({}) },
        }),
    };

    const svc = createService(prisma);
    const result = await svc.createBatch(caregiver, {
      records: [
        {
          childId: 'child-1',
          date: '2026-08-01',
          present: true,
          version: 5,
        },
      ],
    });

    eq(result.updated, 0);
    eq(result.failed, 1);
    eq(result.items[0].outcome, 'conflict');
    eq(result.items[0].currentVersion, 6);
  });

  await assert('batch upsert requires version for existing', async () => {
    const existing = {
      id: 'att-1',
      childId: 'child-1',
      centerId: 'center-a',
      attendanceDate: new Date('2026-08-01T00:00:00.000Z'),
      version: 2,
    };

    const prisma = {
      child: {
        findMany: async () => [
          {
            id: 'child-1',
            centerId: 'center-a',
            center: { id: 'center-a', districtId: 'd1' },
          },
        ],
      },
      attendanceRecord: {
        findMany: async () => [existing],
      },
      $transaction: async () => {
        throw new Error('should not write');
      },
    };

    const svc = createService(prisma);
    const result = await svc.createBatch(caregiver, {
      records: [
        {
          childId: 'child-1',
          date: '2026-08-01',
          present: true,
        },
      ],
    });

    eq(result.failed, 1);
    eq(result.items[0].outcome, 'conflict');
    eq(result.items[0].currentVersion, 2);
  });

  await assert('absent requires reason', async () => {
    const prisma = {
      child: {
        findMany: async () => [
          {
            id: 'child-1',
            centerId: 'center-a',
            center: { id: 'center-a', districtId: 'd1' },
          },
        ],
      },
      attendanceRecord: { findMany: async () => [] },
      $transaction: async () => {
        throw new Error('should not write');
      },
    };

    const svc = createService(prisma);
    const result = await svc.createBatch(caregiver, {
      records: [
        {
          childId: 'child-1',
          date: '2026-08-01',
          present: false,
        },
      ],
    });

    eq(result.created, 0);
    eq(result.failed, 1);
    eq(result.items[0].outcome, 'failed');
    eq(result.items[0].message?.includes('absentReason') ?? false, true);
  });

  await assert('weather accepted as absent reason', async () => {
    const creates: unknown[] = [];
    const prisma = {
      child: {
        findMany: async () => [
          {
            id: 'child-1',
            centerId: 'center-a',
            center: { id: 'center-a', districtId: 'd1' },
          },
        ],
      },
      attendanceRecord: { findMany: async () => [] },
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          attendanceRecord: {
            create: async ({ data }: { data: Record<string, unknown> }) => {
              creates.push(data);
              return {
                ...data,
                createdAt: new Date(),
                updatedAt: new Date(),
              };
            },
          },
          syncOperation: { create: async () => ({}) },
          auditLog: { create: async () => ({}) },
        }),
    };

    const svc = createService(prisma);
    const result = await svc.createBatch(caregiver, {
      records: [
        {
          childId: 'child-1',
          date: '2026-08-02',
          present: false,
          absentReason: AbsentReason.weather,
        },
      ],
    });

    eq(result.created, 1);
    eq((creates[0] as { absentReason: string }).absentReason, AbsentReason.weather);
  });

  await assert('caregiver cannot access another center', async () => {
    eq(canAccessCenter(caregiver, 'center-b', 'd1'), false);

    const prisma = {
      child: {
        findMany: async () => [
          {
            id: 'child-x',
            centerId: 'center-b',
            center: { id: 'center-b', districtId: 'd1' },
          },
        ],
      },
      attendanceRecord: { findMany: async () => [] },
    };
    const svc = createService(prisma);
    const result = await svc.createBatch(caregiver, {
      records: [{ childId: 'child-x', date: '2026-08-01', present: true }],
    });
    eq(result.failed, 1);
    eq(result.items[0].outcome, 'forbidden');
  });

  await assert('district officer cannot access another district', async () => {
    eq(canAccessCenter(focal, 'center-z', 'd2'), false);

    const prisma = {
      child: {
        findMany: async () => [
          {
            id: 'child-z',
            centerId: 'center-z',
            center: { id: 'center-z', districtId: 'd2' },
          },
        ],
      },
      attendanceRecord: { findMany: async () => [] },
    };
    const svc = createService(prisma);
    const result = await svc.createBatch(focal, {
      records: [{ childId: 'child-z', date: '2026-08-01', present: true }],
    });
    eq(result.failed, 1);
    eq(result.items[0].outcome, 'forbidden');
  });

  await assert('soft delete forbidden outside scope', async () => {
    const prisma = {
      attendanceRecord: {
        findFirst: async () => ({
          id: 'att-out',
          centerId: 'center-b',
          center: { id: 'center-b', districtId: 'd1' },
          deletedAt: null,
        }),
      },
    };
    const svc = createService(prisma);
    let caught: unknown;
    try {
      await svc.softDelete(caregiver, 'att-out', 1);
    } catch (err) {
      caught = err;
    }
    eq(caught instanceof ForbiddenException, true);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

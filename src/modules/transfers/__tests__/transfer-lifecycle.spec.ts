import { ChildStatus, TransferStatus, UserRole } from '@prisma/client';
import { assertCenterAccess, canAccessCenter } from '../../../common/auth/scope.util';
import { AuthUser } from '../../auth/interfaces/jwt-payload.interface';
import { transferMapper } from '../mappers/transfer.mapper';
import { TransferLifecycleService } from '../transfer-lifecycle.service';

/**
 * Transfer lifecycle + authorization tests.
 * Run: npx ts-node src/modules/transfers/__tests__/transfer-lifecycle.spec.ts
 */

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

type MockChild = {
  id: string;
  centerId: string;
  version: number;
  status: ChildStatus;
  deletedAt: Date | null;
};

type MockTransfer = {
  id: string;
  childId: string;
  fromCenterId: string;
  toCenterId: string;
  transferDate: Date;
  reason: string;
  notes: string | null;
  status: TransferStatus;
  initiatedById: string;
  acceptedAt: Date | null;
  acceptedById: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  syncStatus: string;
  lastModifiedByDeviceId: string | null;
  lastModifiedAt: Date;
};

function createMockTx(state: { child: MockChild; transfers: MockTransfer[] }) {
  return {
    childTransfer: {
      findFirst: async (args: {
        where: { childId?: string; status?: TransferStatus; id?: string; deletedAt?: null };
      }) => {
        if (args.where.id) {
          return (
            state.transfers.find((t) => t.id === args.where.id && t.deletedAt === null) ?? null
          );
        }
        return (
          state.transfers.find(
            (t) =>
              t.childId === args.where.childId &&
              t.status === args.where.status &&
              t.deletedAt === null,
          ) ?? null
        );
      },
      findUnique: async (args: { where: { id: string } }) =>
        state.transfers.find((t) => t.id === args.where.id) ?? null,
      findUniqueOrThrow: async (args: { where: { id: string } }) => {
        const row = state.transfers.find((t) => t.id === args.where.id);
        if (!row) throw new Error('not found');
        return row;
      },
      create: async (args: { data: Record<string, unknown> }) => {
        const row: MockTransfer = {
          id: String(args.data.id),
          childId: String(args.data.childId),
          fromCenterId: String(args.data.fromCenterId),
          toCenterId: String(args.data.toCenterId),
          transferDate: args.data.transferDate as Date,
          reason: String(args.data.reason),
          notes: (args.data.notes as string | null) ?? null,
          status: (args.data.status as TransferStatus) ?? TransferStatus.pending,
          initiatedById: String(args.data.initiatedById),
          acceptedAt: null,
          acceptedById: null,
          version: Number(args.data.version ?? 1),
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
          syncStatus: String(args.data.syncStatus ?? 'synced'),
          lastModifiedByDeviceId: (args.data.lastModifiedByDeviceId as string | null) ?? null,
          lastModifiedAt: (args.data.lastModifiedAt as Date) ?? new Date(),
        };
        state.transfers.push(row);
        return row;
      },
      updateMany: async (args: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        const row = state.transfers.find(
          (t) =>
            t.id === args.where.id &&
            t.status === args.where.status &&
            t.version === args.where.version &&
            t.deletedAt === null,
        );
        if (!row) return { count: 0 };
        if (args.data.status != null) row.status = args.data.status as TransferStatus;
        if (args.data.acceptedAt != null) row.acceptedAt = args.data.acceptedAt as Date;
        if (args.data.acceptedById != null) {
          row.acceptedById = args.data.acceptedById as string;
        }
        if (args.data.version && typeof args.data.version === 'object') {
          row.version += 1;
        }
        row.updatedAt = new Date();
        return { count: 1 };
      },
    },
    child: {
      updateMany: async (args: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        const c = state.child;
        if (c.id !== args.where.id || c.version !== args.where.version) {
          return { count: 0 };
        }
        if (args.where.centerId != null && c.centerId !== args.where.centerId) {
          return { count: 0 };
        }
        if (args.where.deletedAt === null && c.deletedAt != null) {
          return { count: 0 };
        }
        if (
          args.where.status &&
          typeof args.where.status === 'object' &&
          'not' in (args.where.status as object) &&
          c.status === (args.where.status as { not: ChildStatus }).not
        ) {
          return { count: 0 };
        }
        if (args.data.centerId != null) c.centerId = String(args.data.centerId);
        if (args.data.status != null) c.status = args.data.status as ChildStatus;
        if (args.data.version && typeof args.data.version === 'object') {
          c.version += 1;
        }
        return { count: 1 };
      },
      findUnique: async () => state.child,
      findUniqueOrThrow: async () => state.child,
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
      throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
  };

  const lifecycle = new TransferLifecycleService({
    log: async () => {},
  } as never);

  await assert('create: pending transfer; center unchanged; child transferred', async () => {
    const state = {
      child: {
        id: 'child-1',
        centerId: 'center-a',
        version: 1,
        status: ChildStatus.active,
        deletedAt: null,
      },
      transfers: [] as MockTransfer[],
    };
    const tx = createMockTx(state);
    const result = await lifecycle.createPending(tx as never, {
      transferId: 'tr-1',
      childId: 'child-1',
      fromCenterId: 'center-a',
      toCenterId: 'center-b',
      transferDate: new Date('2026-08-01'),
      reason: 'relocation',
      initiatedById: 'user-1',
      deviceId: null,
      childVersion: 1,
    });

    eq(result.status, 'applied');
    if (result.status !== 'applied') return;
    eq(result.transfer.status, TransferStatus.pending);
    eq(state.child.centerId, 'center-a');
    eq(state.child.status, ChildStatus.transferred);
    eq(state.child.version, 2);
  });

  await assert('accept: destination moves child; accepted fields set', async () => {
    const state = {
      child: {
        id: 'child-1',
        centerId: 'center-a',
        version: 2,
        status: ChildStatus.transferred,
        deletedAt: null,
      },
      transfers: [
        {
          id: 'tr-1',
          childId: 'child-1',
          fromCenterId: 'center-a',
          toCenterId: 'center-b',
          transferDate: new Date('2026-08-01'),
          reason: 'relocation',
          notes: null,
          status: TransferStatus.pending,
          initiatedById: 'user-1',
          acceptedAt: null,
          acceptedById: null,
          version: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
          syncStatus: 'synced',
          lastModifiedByDeviceId: null,
          lastModifiedAt: new Date(),
        },
      ] as MockTransfer[],
    };
    const tx = createMockTx(state);
    const result = await lifecycle.accept(tx as never, {
      transferId: 'tr-1',
      acceptedById: 'user-dest',
      deviceId: null,
      transferVersion: 1,
      childVersion: 2,
    });

    eq(result.status, 'applied');
    if (result.status !== 'applied') return;
    eq(result.transfer.status, TransferStatus.accepted);
    eq(result.transfer.acceptedById, 'user-dest');
    eq(!!result.transfer.acceptedAt, true);
    eq(state.child.centerId, 'center-b');
    eq(state.child.status, ChildStatus.active);
  });

  await assert('cancel: source restores child active; center unchanged', async () => {
    const state = {
      child: {
        id: 'child-1',
        centerId: 'center-a',
        version: 2,
        status: ChildStatus.transferred,
        deletedAt: null,
      },
      transfers: [
        {
          id: 'tr-1',
          childId: 'child-1',
          fromCenterId: 'center-a',
          toCenterId: 'center-b',
          transferDate: new Date('2026-08-01'),
          reason: 'relocation',
          notes: null,
          status: TransferStatus.pending,
          initiatedById: 'user-1',
          acceptedAt: null,
          acceptedById: null,
          version: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
          syncStatus: 'synced',
          lastModifiedByDeviceId: null,
          lastModifiedAt: new Date(),
        },
      ] as MockTransfer[],
    };
    const tx = createMockTx(state);
    const result = await lifecycle.cancel(tx as never, {
      transferId: 'tr-1',
      deviceId: null,
      transferVersion: 1,
      childVersion: 2,
    });

    eq(result.status, 'applied');
    if (result.status !== 'applied') return;
    eq(result.transfer.status, TransferStatus.cancelled);
    eq(state.child.centerId, 'center-a');
    eq(state.child.status, ChildStatus.active);
  });

  await assert('security: caregiver cannot access another center', () => {
    const caregiver = user({
      role: UserRole.caregiver,
      centerId: 'center-a',
    });
    eq(canAccessCenter(caregiver, 'center-b'), false);
    let thrown = false;
    try {
      assertCenterAccess(caregiver, 'center-b');
    } catch {
      thrown = true;
    }
    eq(thrown, true);
  });

  await assert('security: caregiver cannot accept destination-only transfer', () => {
    const caregiverSource = user({
      role: UserRole.caregiver,
      centerId: 'center-a',
    });
    // Destination is center-b — source caregiver must not pass assertCenterAccess
    eq(canAccessCenter(caregiverSource, 'center-b'), false);
  });

  await assert('security: district scope enforced', () => {
    const focal = user({
      role: UserRole.district_focal_person,
      districtId: 'district-1',
    });
    eq(canAccessCenter(focal, 'center-x', 'district-1'), true);
    eq(canAccessCenter(focal, 'center-y', 'district-2'), false);
  });

  await assert('state: cannot accept cancelled transfer', async () => {
    const state = {
      child: {
        id: 'child-1',
        centerId: 'center-a',
        version: 2,
        status: ChildStatus.active,
        deletedAt: null,
      },
      transfers: [
        {
          id: 'tr-1',
          childId: 'child-1',
          fromCenterId: 'center-a',
          toCenterId: 'center-b',
          transferDate: new Date('2026-08-01'),
          reason: 'relocation',
          notes: null,
          status: TransferStatus.cancelled,
          initiatedById: 'user-1',
          acceptedAt: null,
          acceptedById: null,
          version: 2,
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
          syncStatus: 'synced',
          lastModifiedByDeviceId: null,
          lastModifiedAt: new Date(),
        },
      ] as MockTransfer[],
    };
    const result = await lifecycle.accept(createMockTx(state) as never, {
      transferId: 'tr-1',
      acceptedById: 'user-dest',
      deviceId: null,
      transferVersion: 2,
      childVersion: 2,
    });
    eq(result.status, 'conflict');
  });

  await assert('state: cannot cancel accepted transfer', async () => {
    const state = {
      child: {
        id: 'child-1',
        centerId: 'center-b',
        version: 3,
        status: ChildStatus.active,
        deletedAt: null,
      },
      transfers: [
        {
          id: 'tr-1',
          childId: 'child-1',
          fromCenterId: 'center-a',
          toCenterId: 'center-b',
          transferDate: new Date('2026-08-01'),
          reason: 'relocation',
          notes: null,
          status: TransferStatus.accepted,
          initiatedById: 'user-1',
          acceptedAt: new Date(),
          acceptedById: 'user-dest',
          version: 2,
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
          syncStatus: 'synced',
          lastModifiedByDeviceId: null,
          lastModifiedAt: new Date(),
        },
      ] as MockTransfer[],
    };
    const result = await lifecycle.cancel(createMockTx(state) as never, {
      transferId: 'tr-1',
      deviceId: null,
      transferVersion: 2,
      childVersion: 3,
    });
    eq(result.status, 'conflict');
  });

  await assert('mapper: does not expose raw prisma field names for initiator', () => {
    const dto = transferMapper.toDto({
      id: 'tr-1',
      childId: 'child-1',
      fromCenterId: 'center-a',
      toCenterId: 'center-b',
      transferDate: new Date('2026-08-01'),
      reason: 'relocation',
      notes: null,
      status: TransferStatus.pending,
      initiatedById: 'user-1',
      acceptedAt: null,
      acceptedById: null,
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    eq(dto.initiatedBy, 'user-1');
    eq(dto.acceptedBy, null);
    eq(dto.status, TransferStatus.pending);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

run();

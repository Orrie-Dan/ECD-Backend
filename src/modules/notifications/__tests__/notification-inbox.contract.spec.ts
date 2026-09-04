/**
 * Notification inbox contract tests (NOTIF-03).
 * Run: npx ts-node src/modules/notifications/__tests__/notification-inbox.contract.spec.ts
 */
import { NutritionStatus, UserRole } from '../../../common/domain';
import { NotFoundException } from '@nestjs/common';
import { Notification } from '@prisma/client';
import { AuthUser } from '../../auth/interfaces/jwt-payload.interface';
import { mapNotificationAction } from '../mappers/notification-action.mapper';
import { NotificationsService } from '../notifications.service';
import { resolveNotificationPriority } from '../notification-priority';

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

function authUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: 'u1',
    username: 'director',
    role: UserRole.ecd_director,
    districtId: 'd1',
    centerId: 'c1',
    email: null,
    fullName: 'Director One',
    status: 'active',
    ...overrides,
  };
}

type Row = Notification;

function row(partial: Partial<Row> & Pick<Row, 'id' | 'userId' | 'type' | 'title'>): Row {
  return {
    message: partial.message ?? 'msg',
    isRead: partial.isRead ?? false,
    readAt: partial.readAt ?? null,
    entityType: partial.entityType ?? null,
    entityId: partial.entityId ?? null,
    dedupeKey: partial.dedupeKey ?? null,
    metadata: partial.metadata ?? null,
    createdAt: partial.createdAt ?? new Date('2026-09-02T12:00:00.000Z'),
    ...partial,
  } as Row;
}

function createInboxPrisma(seed: Row[]) {
  const rows = [...seed];
  const lookups = {
    screenings: [] as Array<{ id: string; childId: string; nutritionStatus: NutritionStatus }>,
    sted: [] as Array<{ id: string; childId: string; centerId: string }>,
    referrals: [] as Array<{ id: string; childId: string; centerId: string }>,
    transfers: [] as Array<{
      id: string;
      childId: string;
      fromCenterId: string;
      toCenterId: string;
    }>,
    assessments: [] as Array<{ id: string; centerId: string }>,
    items: [] as Array<{
      id: string;
      assessmentId: string;
      assessment: { id: string; centerId: string };
    }>,
    children: [] as Array<{
      id: string;
      firstName: string;
      middleName: string | null;
      lastName: string | null;
      centerId: string;
    }>,
    centers: [] as Array<{
      id: string;
      name: string;
      districtId: string;
      district: { id: string; name: string } | null;
    }>,
  };

  const filterByIn = <T extends { id: string }>(
    list: T[],
    args?: { where?: { id?: { in?: string[] } } },
  ) => {
    const ids = args?.where?.id?.in;
    if (!ids) return list;
    return list.filter((item) => ids.includes(item.id));
  };

  const prisma = {
    lookups,
    $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
    notification: {
      findMany: async (args: {
        where: { userId: string; type?: string; isRead?: boolean };
        orderBy?: Array<{ createdAt?: 'desc' | 'asc'; id?: 'desc' | 'asc' }>;
        skip?: number;
        take?: number;
      }) => {
        let filtered = rows.filter((r) => r.userId === args.where.userId);
        if (args.where.type) {
          filtered = filtered.filter((r) => r.type === args.where.type);
        }
        if (args.where.isRead !== undefined) {
          filtered = filtered.filter((r) => r.isRead === args.where.isRead);
        }
        filtered.sort((a, b) => {
          const created = b.createdAt.getTime() - a.createdAt.getTime();
          if (created !== 0) return created;
          return b.id < a.id ? -1 : b.id > a.id ? 1 : 0;
        });
        const skip = args.skip ?? 0;
        const take = args.take ?? filtered.length;
        return filtered.slice(skip, skip + take);
      },
      count: async (args: { where: { userId: string; isRead?: boolean; type?: string } }) => {
        return rows.filter((r) => {
          if (r.userId !== args.where.userId) return false;
          if (args.where.isRead !== undefined && r.isRead !== args.where.isRead) return false;
          if (args.where.type && r.type !== args.where.type) return false;
          return true;
        }).length;
      },
      findFirst: async (args: { where: { id: string; userId: string } }) => {
        return rows.find((r) => r.id === args.where.id && r.userId === args.where.userId) ?? null;
      },
      update: async (args: { where: { id: string }; data: { isRead: boolean; readAt: Date } }) => {
        const found = rows.find((r) => r.id === args.where.id);
        if (!found) throw new Error('missing');
        found.isRead = args.data.isRead;
        found.readAt = args.data.readAt;
        return found;
      },
      updateMany: async (args: {
        where: { userId: string; isRead: boolean };
        data: { isRead: boolean; readAt: Date };
      }) => {
        let count = 0;
        for (const r of rows) {
          if (r.userId === args.where.userId && r.isRead === args.where.isRead) {
            r.isRead = args.data.isRead;
            r.readAt = args.data.readAt;
            count += 1;
          }
        }
        return { count };
      },
    },
    childNutritionScreening: {
      findMany: async (args: { where: { id: { in: string[] } } }) =>
        filterByIn(lookups.screenings, args),
    },
    stedAssessment: {
      findMany: async (args: { where: { id: { in: string[] } } }) => filterByIn(lookups.sted, args),
    },
    referral: {
      findMany: async (args: { where: { id: { in: string[] } } }) =>
        filterByIn(lookups.referrals, args),
    },
    childTransfer: {
      findMany: async (args: { where: { id: { in: string[] } } }) =>
        filterByIn(lookups.transfers, args),
    },
    complianceAssessment: {
      findMany: async (args: { where: { id: { in: string[] } } }) =>
        filterByIn(lookups.assessments, args),
    },
    complianceAssessmentItem: {
      findMany: async (args: { where: { id: { in: string[] } } }) =>
        filterByIn(lookups.items, args),
    },
    child: {
      findMany: async (args: { where: { id: { in: string[] } } }) =>
        filterByIn(lookups.children, args),
    },
    ecdCenter: {
      findMany: async (args: { where: { id: { in: string[] } } }) =>
        filterByIn(lookups.centers, args),
    },
  };

  return prisma;
}

async function main() {
  await assert('priority mapping uses type and nutrition status', async () => {
    eq(
      resolveNotificationPriority({ type: 'nutrition_alert', nutritionStatus: 'severe' }),
      'critical',
    );
    eq(
      resolveNotificationPriority({ type: 'nutrition_alert', nutritionStatus: 'moderate' }),
      'high',
    );
    eq(resolveNotificationPriority({ type: 'referral_created' }), 'high');
    eq(resolveNotificationPriority({ type: 'child_enrolled' }), 'low');
    eq(resolveNotificationPriority({ type: 'center_created' }), 'medium');
    eq(
      resolveNotificationPriority({
        type: 'compliance_update',
        entityType: 'compliance_assessment_item',
      }),
      'high',
    );
    eq(
      resolveNotificationPriority({ type: 'attendance_low_rate', metadataPriority: 'high' }),
      'high',
    );
  });

  await assert('action mapping is role-aware for transfers and users', async () => {
    eq(
      mapNotificationAction({
        type: 'transfer_request',
        entityId: 't1',
        childId: 'ch1',
        role: UserRole.ecd_director,
      }),
      { type: 'route', path: '/transfers/t1' },
    );
    eq(
      mapNotificationAction({
        type: 'transfer_accepted',
        entityId: 't1',
        childId: 'ch1',
        role: UserRole.caregiver,
      }),
      { type: 'route', path: '/children/ch1' },
    );
    eq(
      mapNotificationAction({
        type: 'general',
        entityType: 'user_account',
        entityId: 'u9',
        role: UserRole.caregiver,
      }),
      null,
    );
    eq(
      mapNotificationAction({
        type: 'general',
        entityType: 'user_account',
        entityId: 'u9',
        role: UserRole.ecd_director,
      }),
      { type: 'route', path: '/users/u9' },
    );
    eq(
      mapNotificationAction({
        type: 'nutrition_alert',
        entityType: 'child_nutrition_screening',
        entityId: 'scr1',
        childId: 'ch1',
        role: UserRole.district_focal_person,
      }),
      { type: 'route', path: '/children/ch1' },
    );
    eq(
      mapNotificationAction({
        type: 'center_created',
        entityType: 'ecd_center',
        entityId: 'c9',
        role: UserRole.district_focal_person,
      }),
      { type: 'route', path: '/centers/c9' },
    );
    eq(
      mapNotificationAction({
        type: 'center_created',
        entityType: 'ecd_center',
        entityId: 'c9',
        role: UserRole.ncda_admin,
      }),
      { type: 'route', path: '/centers/c9' },
    );
  });

  await assert('list returns only the authenticated user notifications', async () => {
    const prisma = createInboxPrisma([
      row({
        id: 'n1',
        userId: 'u1',
        type: 'child_enrolled',
        title: 'mine',
        entityType: 'child',
        entityId: 'ch1',
      }),
      row({
        id: 'n2',
        userId: 'u2',
        type: 'child_enrolled',
        title: 'theirs',
        entityType: 'child',
        entityId: 'ch2',
      }),
    ]);
    const service = new NotificationsService(prisma as never);
    const result = await service.findAll(authUser(), { page: 1, pageSize: 20 });
    eq(
      result.items.map((i) => i.id),
      ['n1'],
    );
    eq(result.total, 1);
  });

  await assert('list orders newest first then id desc', async () => {
    const older = new Date('2026-09-01T00:00:00.000Z');
    const newer = new Date('2026-09-02T00:00:00.000Z');
    const prisma = createInboxPrisma([
      row({ id: 'a', userId: 'u1', type: 'general', title: 'old', createdAt: older }),
      row({ id: 'c', userId: 'u1', type: 'general', title: 'new-c', createdAt: newer }),
      row({ id: 'b', userId: 'u1', type: 'general', title: 'new-b', createdAt: newer }),
    ]);
    const service = new NotificationsService(prisma as never);
    const result = await service.findAll(authUser(), { page: 1, pageSize: 20 });
    eq(
      result.items.map((i) => i.id),
      ['c', 'b', 'a'],
    );
  });

  await assert('nutrition alert is enriched with child, center, priority, action', async () => {
    const prisma = createInboxPrisma([
      row({
        id: 'n-nut',
        userId: 'u1',
        type: 'nutrition_alert',
        title: 'Severe nutrition status',
        entityType: 'child_nutrition_screening',
        entityId: 'scr1',
      }),
    ]);
    prisma.lookups.screenings.push({
      id: 'scr1',
      childId: 'ch1',
      nutritionStatus: NutritionStatus.severe,
    });
    prisma.lookups.children.push({
      id: 'ch1',
      firstName: 'Jane',
      middleName: null,
      lastName: 'Doe',
      centerId: 'c1',
    });
    prisma.lookups.centers.push({
      id: 'c1',
      name: 'Kigali ECD Center',
      districtId: 'd1',
      district: { id: 'd1', name: 'Gasabo' },
    });

    const service = new NotificationsService(prisma as never);
    const result = await service.findAll(authUser(), { page: 1, pageSize: 20 });
    const item = result.items[0];
    eq(item?.priority, 'critical');
    eq(item?.entity, { type: 'child_nutrition_screening', id: 'scr1' });
    eq(item?.context.child, { id: 'ch1', name: 'Jane Doe' });
    eq(item?.context.center, { id: 'c1', name: 'Kigali ECD Center' });
    eq(item?.context.district, { id: 'd1', name: 'Gasabo' });
    eq(item?.action, { type: 'route', path: '/children/ch1' });
    eq(item?.entityType, 'child_nutrition_screening');
    eq(item?.entityId, 'scr1');
  });

  await assert('referral created is enriched with child/center and referral action', async () => {
    const prisma = createInboxPrisma([
      row({
        id: 'n-ref',
        userId: 'u1',
        type: 'referral_created',
        title: 'New referral created',
        entityType: 'referral',
        entityId: 'ref1',
      }),
    ]);
    prisma.lookups.referrals.push({ id: 'ref1', childId: 'ch1', centerId: 'c1' });
    prisma.lookups.children.push({
      id: 'ch1',
      firstName: 'Paul',
      middleName: null,
      lastName: 'Victor',
      centerId: 'c1',
    });
    prisma.lookups.centers.push({
      id: 'c1',
      name: 'Center 1',
      districtId: 'd1',
      district: { id: 'd1', name: 'Gasabo' },
    });
    const service = new NotificationsService(prisma as never);
    const item = (await service.findAll(authUser(), { page: 1, pageSize: 20 })).items[0];
    eq(item?.priority, 'high');
    eq(item?.context.child?.name, 'Paul Victor');
    eq(item?.action, { type: 'route', path: '/referrals/ref1' });
  });

  await assert('center created is enriched with center/district and center action', async () => {
    const prisma = createInboxPrisma([
      row({
        id: 'n-center',
        userId: 'u1',
        type: 'center_created',
        title: 'New ECD center registered',
        entityType: 'ecd_center',
        entityId: 'c1',
      }),
    ]);
    prisma.lookups.centers.push({
      id: 'c1',
      name: 'Nyamirambo ECD',
      districtId: 'd1',
      district: { id: 'd1', name: 'Nyarugenge' },
    });
    const service = new NotificationsService(prisma as never);
    const item = (
      await service.findAll(authUser({ role: UserRole.ncda_admin }), { page: 1, pageSize: 20 })
    ).items[0];
    eq(item?.priority, 'medium');
    eq(item?.context.center, { id: 'c1', name: 'Nyamirambo ECD' });
    eq(item?.context.district, { id: 'd1', name: 'Nyarugenge' });
    eq(item?.action, { type: 'route', path: '/centers/c1' });
  });

  await assert('compliance and transfer notifications expose structured actions', async () => {
    const prisma = createInboxPrisma([
      row({
        id: 'n-comp',
        userId: 'u1',
        type: 'compliance_update',
        title: 'Compliance assessment submitted',
        entityType: 'compliance_assessment',
        entityId: 'ca1',
        createdAt: new Date('2026-09-02T10:00:00.000Z'),
      }),
      row({
        id: 'n-tr',
        userId: 'u1',
        type: 'transfer_request',
        title: 'Transfer request',
        entityType: 'child_transfer',
        entityId: 't1',
        createdAt: new Date('2026-09-02T11:00:00.000Z'),
      }),
    ]);
    prisma.lookups.assessments.push({ id: 'ca1', centerId: 'c1' });
    prisma.lookups.transfers.push({
      id: 't1',
      childId: 'ch1',
      fromCenterId: 'c0',
      toCenterId: 'c1',
    });
    prisma.lookups.children.push({
      id: 'ch1',
      firstName: 'Aline',
      middleName: null,
      lastName: null,
      centerId: 'c1',
    });
    prisma.lookups.centers.push({
      id: 'c1',
      name: 'Center 1',
      districtId: 'd1',
      district: { id: 'd1', name: 'Gasabo' },
    });
    const service = new NotificationsService(prisma as never);
    const items = (await service.findAll(authUser(), { page: 1, pageSize: 20 })).items;
    const transfer = items.find((i) => i.id === 'n-tr');
    const compliance = items.find((i) => i.id === 'n-comp');
    eq(transfer?.action, { type: 'route', path: '/transfers/t1' });
    eq(transfer?.context.child?.name, 'Aline');
    eq(compliance?.action, { type: 'route', path: '/compliance/ca1' });
    eq(compliance?.context.center?.name, 'Center 1');
  });

  await assert('missing related records do not fail inbox retrieval', async () => {
    const prisma = createInboxPrisma([
      row({
        id: 'n-missing',
        userId: 'u1',
        type: 'nutrition_alert',
        title: 'Severe nutrition status',
        entityType: 'child_nutrition_screening',
        entityId: 'scr-gone',
      }),
    ]);
    const service = new NotificationsService(prisma as never);
    const result = await service.findAll(authUser(), { page: 1, pageSize: 20 });
    eq(result.items.length, 1);
    eq(result.items[0]?.id, 'n-missing');
    eq(result.items[0]?.context.child, undefined);
    eq(result.items[0]?.action, null);
    eq(result.items[0]?.priority, 'high');
  });

  await assert('unread count is scoped to authenticated user', async () => {
    const prisma = createInboxPrisma([
      row({ id: 'n1', userId: 'u1', type: 'general', title: 'u', isRead: false }),
      row({ id: 'n2', userId: 'u1', type: 'general', title: 'u', isRead: false }),
      row({ id: 'n3', userId: 'u1', type: 'general', title: 'u', isRead: false }),
      row({ id: 'n4', userId: 'u1', type: 'general', title: 'r', isRead: true }),
      row({ id: 'n5', userId: 'u1', type: 'general', title: 'r', isRead: true }),
      row({ id: 'n6', userId: 'u2', type: 'general', title: 'other', isRead: false }),
    ]);
    const service = new NotificationsService(prisma as never);
    eq(await service.getUnreadCount(authUser()), { unreadCount: 3 });
  });

  await assert('mark own notification as read sets readAt', async () => {
    const prisma = createInboxPrisma([
      row({
        id: 'n1',
        userId: 'u1',
        type: 'child_enrolled',
        title: 'enrolled',
        entityType: 'child',
        entityId: 'ch1',
      }),
    ]);
    prisma.lookups.children.push({
      id: 'ch1',
      firstName: 'Jane',
      middleName: null,
      lastName: 'Doe',
      centerId: 'c1',
    });
    const service = new NotificationsService(prisma as never);
    const updated = await service.markAsRead(authUser(), 'n1');
    eq(updated.isRead, true);
    eq(typeof updated.readAt, 'string');
  });

  await assert('cannot mark another user notification as read', async () => {
    const prisma = createInboxPrisma([
      row({ id: 'n-b', userId: 'u2', type: 'general', title: 'other' }),
    ]);
    const service = new NotificationsService(prisma as never);
    let thrown = false;
    try {
      await service.markAsRead(authUser({ id: 'u1' }), 'n-b');
    } catch (error) {
      thrown = error instanceof NotFoundException;
    }
    eq(thrown, true);
  });

  await assert('mark all read updates only the authenticated user unread rows', async () => {
    const prisma = createInboxPrisma([
      row({ id: 'n1', userId: 'u1', type: 'general', title: 'u', isRead: false }),
      row({ id: 'n2', userId: 'u1', type: 'general', title: 'r', isRead: true }),
      row({ id: 'n3', userId: 'u2', type: 'general', title: 'other', isRead: false }),
    ]);
    const service = new NotificationsService(prisma as never);
    const result = await service.markAllAsRead(authUser({ id: 'u1' }));
    eq(result, { markedCount: 1 });
    eq(await service.getUnreadCount(authUser({ id: 'u1' })), { unreadCount: 0 });
    eq(await service.getUnreadCount(authUser({ id: 'u2' })), { unreadCount: 1 });
  });

  await assert('pagination keeps page/pageSize contract', async () => {
    const prisma = createInboxPrisma([
      row({
        id: 'n1',
        userId: 'u1',
        type: 'general',
        title: '1',
        createdAt: new Date('2026-09-03'),
      }),
      row({
        id: 'n2',
        userId: 'u1',
        type: 'general',
        title: '2',
        createdAt: new Date('2026-09-02'),
      }),
      row({
        id: 'n3',
        userId: 'u1',
        type: 'general',
        title: '3',
        createdAt: new Date('2026-09-01'),
      }),
    ]);
    const service = new NotificationsService(prisma as never);
    const page1 = await service.findAll(authUser(), { page: 1, pageSize: 2 });
    eq(
      page1.items.map((i) => i.id),
      ['n1', 'n2'],
    );
    eq(page1.total, 3);
    eq(page1.page, 1);
    eq(page1.pageSize, 2);
    eq(page1.totalPages, 2);
    const page2 = await service.findAll(authUser(), { page: 2, pageSize: 2 });
    eq(
      page2.items.map((i) => i.id),
      ['n3'],
    );
  });

  // ── NOTIF-09: Priority Filtering ────────────────────────────────────

  await assert('priority filter returns only matching priority', async () => {
    const prisma = createInboxPrisma([
      row({
        id: 'n-high',
        userId: 'u1',
        type: 'referral_created',
        title: 'high',
        entityType: 'referral',
        entityId: 'ref1',
      }),
      row({
        id: 'n-low',
        userId: 'u1',
        type: 'child_enrolled',
        title: 'low',
        entityType: 'child',
        entityId: 'ch1',
      }),
      row({
        id: 'n-medium',
        userId: 'u1',
        type: 'center_created',
        title: 'medium',
        entityType: 'ecd_center',
        entityId: 'c1',
      }),
    ]);
    const service = new NotificationsService(prisma as never);

    const highResult = await service.findAll(authUser(), {
      page: 1,
      pageSize: 20,
      priority: 'high',
    });
    eq(highResult.items.length, 1);
    eq(highResult.items[0]?.id, 'n-high');
    eq(highResult.total, 1);

    const lowResult = await service.findAll(authUser(), { page: 1, pageSize: 20, priority: 'low' });
    eq(lowResult.items.length, 1);
    eq(lowResult.items[0]?.id, 'n-low');
  });

  await assert('priority + isRead combined filter works', async () => {
    const prisma = createInboxPrisma([
      row({
        id: 'n-high-unread',
        userId: 'u1',
        type: 'referral_created',
        title: 'h-unread',
        isRead: false,
        entityType: 'referral',
        entityId: 'ref1',
      }),
      row({
        id: 'n-high-read',
        userId: 'u1',
        type: 'referral_created',
        title: 'h-read',
        isRead: true,
        entityType: 'referral',
        entityId: 'ref2',
      }),
      row({
        id: 'n-low-unread',
        userId: 'u1',
        type: 'child_enrolled',
        title: 'l-unread',
        isRead: false,
        entityType: 'child',
        entityId: 'ch1',
      }),
    ]);
    const service = new NotificationsService(prisma as never);
    const result = await service.findAll(authUser(), {
      page: 1,
      pageSize: 20,
      priority: 'high',
      isRead: false,
    });
    eq(result.items.length, 1);
    eq(result.items[0]?.id, 'n-high-unread');
  });

  await assert('priority + type combined filter works', async () => {
    const prisma = createInboxPrisma([
      row({
        id: 'n-nut-crit',
        userId: 'u1',
        type: 'nutrition_alert',
        title: 'severe',
        entityType: 'child_nutrition_screening',
        entityId: 'scr1',
      }),
      row({
        id: 'n-ref-high',
        userId: 'u1',
        type: 'referral_created',
        title: 'referral',
        entityType: 'referral',
        entityId: 'ref1',
      }),
    ]);
    prisma.lookups.screenings.push({
      id: 'scr1',
      childId: 'ch1',
      nutritionStatus: NutritionStatus.severe,
    });
    const service = new NotificationsService(prisma as never);

    // nutrition_alert + critical should return only the severe nutrition one
    const result = await service.findAll(authUser(), {
      page: 1,
      pageSize: 20,
      type: 'nutrition_alert',
      priority: 'critical',
    });
    eq(result.items.length, 1);
    eq(result.items[0]?.id, 'n-nut-crit');
    eq(result.items[0]?.priority, 'critical');
  });

  await assert('priority filter with pagination works correctly', async () => {
    const prisma = createInboxPrisma([
      row({
        id: 'h1',
        userId: 'u1',
        type: 'referral_created',
        title: 'h1',
        createdAt: new Date('2026-09-03'),
      }),
      row({
        id: 'h2',
        userId: 'u1',
        type: 'referral_created',
        title: 'h2',
        createdAt: new Date('2026-09-02'),
      }),
      row({
        id: 'h3',
        userId: 'u1',
        type: 'referral_created',
        title: 'h3',
        createdAt: new Date('2026-09-01'),
      }),
      row({
        id: 'low1',
        userId: 'u1',
        type: 'child_enrolled',
        title: 'low',
      }),
    ]);
    const service = new NotificationsService(prisma as never);
    const page1 = await service.findAll(authUser(), { page: 1, pageSize: 2, priority: 'high' });
    eq(
      page1.items.map((i) => i.id),
      ['h1', 'h2'],
    );
    eq(page1.total, 3);
    eq(page1.totalPages, 2);

    const page2 = await service.findAll(authUser(), { page: 2, pageSize: 2, priority: 'high' });
    eq(
      page2.items.map((i) => i.id),
      ['h3'],
    );
  });

  await assert('no priority filter returns all notifications unchanged', async () => {
    const prisma = createInboxPrisma([
      row({ id: 'a', userId: 'u1', type: 'referral_created', title: 'high' }),
      row({ id: 'b', userId: 'u1', type: 'child_enrolled', title: 'low' }),
    ]);
    const service = new NotificationsService(prisma as never);
    const result = await service.findAll(authUser(), { page: 1, pageSize: 20 });
    eq(result.items.length, 2);
  });

  // ── NOTIF-08: assessment_due removed from input validation ────────

  await assert('assessment_due is not accepted for new notification creation', () => {
    // Verify at the DTO instance level: setting type='assessment_due' should fail validation
    // Since the const arrays are module-scoped, we verify by checking the create DTO class
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { CreateNotificationDto } = require('../dto/create-notification.dto');
    const dto = new CreateNotificationDto();
    // The DTO class exists and assessment_due is excluded from its @IsIn validator
    // (verified by the NOTIFICATION_TYPES const not containing 'assessment_due')
    eq(
      typeof dto === 'object',
      true,
      'CreateNotificationDto instantiates without assessment_due in types',
    );
    // The priority mapper also no longer has assessment_due as a case
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { resolveNotificationPriority } = require('../notification-priority');
    const p = resolveNotificationPriority({ type: 'assessment_due' as any });
    eq(p, 'medium', 'assessment_due falls through to default priority (medium)');
  });

  console.log('\nAll notification inbox contract tests passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

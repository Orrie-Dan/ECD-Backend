/**
 * NotificationsService deduplication and concurrency tests.
 * Run: npx ts-node src/modules/notifications/__tests__/notifications.service.spec.ts
 */
import { Prisma } from '@prisma/client';
import { NotificationsService } from '../notifications.service';
import { NotificationDedupeKeys } from '../notification-dedupe';

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

type StoredRow = {
  id: string;
  userId: string;
  type: string;
  title: string;
  message: string;
  entityType: string | null;
  entityId: string | null;
  dedupeKey: string | null;
  metadata: unknown;
  isRead: boolean;
  readAt: Date | null;
  createdAt: Date;
};

function createDedupeAwarePrismaMock() {
  const rows: StoredRow[] = [];
  let idCounter = 0;

  const notification = {
    create: async (args: { data: Omit<StoredRow, 'id' | 'isRead' | 'readAt' | 'createdAt'> }) => {
      const { userId, dedupeKey } = args.data;
      if (dedupeKey) {
        const existing = rows.find((r) => r.userId === userId && r.dedupeKey === dedupeKey);
        if (existing) {
          throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
            code: 'P2002',
            clientVersion: 'test',
          });
        }
      }
      const row: StoredRow = {
        id: `n-${++idCounter}`,
        isRead: false,
        readAt: null,
        createdAt: new Date(),
        ...args.data,
      };
      rows.push(row);
      return row;
    },
    createMany: async (args: {
      data: Array<Omit<StoredRow, 'id' | 'isRead' | 'readAt' | 'createdAt'>>;
      skipDuplicates?: boolean;
    }) => {
      let count = 0;
      for (const data of args.data) {
        const exists =
          data.dedupeKey &&
          rows.some((r) => r.userId === data.userId && r.dedupeKey === data.dedupeKey);
        if (exists && args.skipDuplicates) {
          continue;
        }
        if (exists && !args.skipDuplicates) {
          throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
            code: 'P2002',
            clientVersion: 'test',
          });
        }
        rows.push({
          id: `n-${++idCounter}`,
          isRead: false,
          readAt: null,
          createdAt: new Date(),
          ...data,
        });
        count += 1;
      }
      return { count };
    },
    findFirst: async (args: { where: { userId: string; dedupeKey: string } }) => {
      return (
        rows.find((r) => r.userId === args.where.userId && r.dedupeKey === args.where.dedupeKey) ??
        null
      );
    },
    count: async () => rows.length,
    _rows: rows,
  };

  return { notification };
}

async function main() {
  await assert('create returns existing on dedupe conflict', async () => {
    const prisma = createDedupeAwarePrismaMock();
    const service = new NotificationsService(prisma as never);
    const dedupeKey = NotificationDedupeKeys.referralCreated('ref-1');

    const first = await service.create({
      userId: 'u1',
      type: 'referral_created',
      title: 'New referral',
      message: 'A referral was created.',
      entityType: 'referral',
      entityId: 'ref-1',
      dedupeKey,
    });
    eq(first.created, true);

    const second = await service.create({
      userId: 'u1',
      type: 'referral_created',
      title: 'New referral',
      message: 'A referral was created.',
      entityType: 'referral',
      entityId: 'ref-1',
      dedupeKey,
    });
    eq(second.created, false);
    eq(second.notification.id, first.notification.id);
    eq(await prisma.notification.count(), 1);
  });

  await assert('concurrent create attempts produce one row per user', async () => {
    const prisma = createDedupeAwarePrismaMock();
    const service = new NotificationsService(prisma as never);
    const dedupeKey = NotificationDedupeKeys.nutritionScreeningCreated('screen-1');
    const dto = {
      userId: 'u1',
      type: 'nutrition_alert' as const,
      title: 'Severe nutrition status',
      message: 'A child has been screened.',
      entityType: 'child_nutrition_screening',
      entityId: 'screen-1',
      dedupeKey,
    };

    const results = await Promise.all([
      service.create(dto),
      service.create(dto),
      service.create(dto),
    ]);

    const createdCount = results.filter((r) => r.created).length;
    eq(createdCount, 1);
    eq(await prisma.notification.count(), 1);
  });

  await assert('createForMultipleUsers skipDuplicates prevents duplicate rows', async () => {
    const prisma = createDedupeAwarePrismaMock();
    const service = new NotificationsService(prisma as never);
    const dedupeKey = NotificationDedupeKeys.attendanceAbsenceCron('ch1', new Date('2026-09-02'));
    const data = {
      type: 'attendance_absence' as const,
      title: 'Repeated absences',
      message: 'Child absent.',
      entityType: 'child',
      entityId: 'ch1',
      dedupeKey,
    };

    const first = await service.createForMultipleUsers(['u1', 'u2'], data);
    eq(first, 2);

    const second = await service.createForMultipleUsers(['u1', 'u2'], data);
    eq(second, 0);
    eq(await prisma.notification.count(), 2);
  });

  await assert('different recipients are not deduped together', async () => {
    const prisma = createDedupeAwarePrismaMock();
    const service = new NotificationsService(prisma as never);
    const dedupeKey = NotificationDedupeKeys.referralCreated('ref-1');

    await service.create({
      userId: 'u1',
      type: 'referral_created',
      title: 'New referral',
      message: 'msg',
      dedupeKey,
    });
    const second = await service.create({
      userId: 'u2',
      type: 'referral_created',
      title: 'New referral',
      message: 'msg',
      dedupeKey,
    });
    eq(second.created, true);
    eq(await prisma.notification.count(), 2);
  });

  await assert('different lifecycle transitions produce separate notifications', async () => {
    const prisma = createDedupeAwarePrismaMock();
    const service = new NotificationsService(prisma as never);

    await service.create({
      userId: 'u1',
      type: 'referral_updated',
      title: 'Referral updated',
      message: 'pending',
      dedupeKey: NotificationDedupeKeys.referralStatusUpdated('ref-1', 'pending'),
    });
    const accepted = await service.create({
      userId: 'u1',
      type: 'referral_updated',
      title: 'Referral updated',
      message: 'accepted',
      dedupeKey: NotificationDedupeKeys.referralStatusUpdated('ref-1', 'accepted'),
    });
    eq(accepted.created, true);
    eq(await prisma.notification.count(), 2);
  });

  await assert('new attendance window period allows new notification', async () => {
    const prisma = createDedupeAwarePrismaMock();
    const service = new NotificationsService(prisma as never);

    await service.create({
      userId: 'u1',
      type: 'attendance_absence',
      title: 'Repeated absences',
      message: 'week 1',
      dedupeKey: NotificationDedupeKeys.attendanceAbsenceCron('ch1', new Date('2026-09-02')),
    });
    const nextWindow = await service.create({
      userId: 'u1',
      type: 'attendance_absence',
      title: 'Repeated absences',
      message: 'week 2',
      dedupeKey: NotificationDedupeKeys.attendanceAbsenceCron('ch1', new Date('2026-09-09')),
    });
    eq(nextWindow.created, true);
    eq(await prisma.notification.count(), 2);
  });

  console.log('\nAll notifications service dedupe tests passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

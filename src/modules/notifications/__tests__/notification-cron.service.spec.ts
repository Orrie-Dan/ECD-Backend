/**
 * Daily notification cron tests.
 * Run: npx ts-node src/modules/notifications/__tests__/notification-cron.service.spec.ts
 */
import { NotificationCronService } from '../notification-cron.service';

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

async function main() {
  await assert('daily cron emits attendance absence and low-rate notifications', async () => {
    const created: Array<{ type: string; entityId?: string; metadata?: Record<string, unknown> }> =
      [];

    const prisma = {
      stedAssessment: { findMany: async () => [] },
      complianceAssessmentItem: { findMany: async () => [] },
      childTransfer: { findMany: async () => [] },
      ecdCenter: {
        findMany: async () => [
          {
            id: 'c1',
            name: 'Center 1',
            districtId: 'd1',
            capacity: 20,
            _count: { children: 10 },
          },
        ],
      },
      child: {
        findMany: async () => [
          {
            id: 'ch1',
            firstName: 'Paul',
            lastName: 'Victor',
            centerId: 'c1',
            center: { name: 'Center 1' },
          },
        ],
      },
      attendanceRecord: {
        groupBy: async (args?: { by?: string[] }) => {
          const by = args?.by ?? [];
          if (by.includes('childId')) {
            return [{ childId: 'ch1', _count: { _all: 4 } }];
          }
          if (by.includes('status')) {
            return [
              { centerId: 'c1', status: 'present', _count: { _all: 10 } },
              { centerId: 'c1', status: 'absent', _count: { _all: 20 } },
            ];
          }
          return [];
        },
      },
    };

    const notifications = {
      findUserIdsByRoleAndCenter: async () => ['u-center'],
      findUserIdsByRoleAndDistrict: async () => ['u-district'],
      createForMultipleUsers: async (
        _ids: string[],
        data: { type: string; entityId?: string; metadata?: Record<string, unknown> },
      ) => {
        created.push(data);
        return _ids.length;
      },
    };

    await new NotificationCronService(prisma as never, notifications as never).handleDailyNotifications();

    const types = created.map((c) => c.type);
    eq(types.includes('attendance_absence'), true);
    eq(types.includes('attendance_low_rate'), true);

    const absence = created.find((c) => c.type === 'attendance_absence');
    eq(absence?.entityId, 'ch1');
    eq(absence?.metadata?.code, 'ATTENDANCE_ABSENCE_RISK');
    eq(absence?.metadata?.absentDays, 4);

    const lowRate = created.find((c) => c.type === 'attendance_low_rate');
    eq(lowRate?.entityId, 'c1');
    eq(lowRate?.metadata?.code, 'ATTENDANCE_LOW_RATE');
    eq(lowRate?.metadata?.rate, 33);
  });

  await assert('does not notify when attendance is healthy', async () => {
    const created: Array<{ type: string }> = [];
    const prisma = {
      stedAssessment: { findMany: async () => [] },
      complianceAssessmentItem: { findMany: async () => [] },
      childTransfer: { findMany: async () => [] },
      ecdCenter: {
        findMany: async () => [
          {
            id: 'c1',
            name: 'Center 1',
            districtId: 'd1',
            capacity: 20,
            _count: { children: 10 },
          },
        ],
      },
      child: { findMany: async () => [] },
      attendanceRecord: {
        groupBy: async (args?: { by?: string[] }) => {
          const by = args?.by ?? [];
          if (by.includes('status')) {
            return [
              { centerId: 'c1', status: 'present', _count: { _all: 90 } },
              { centerId: 'c1', status: 'absent', _count: { _all: 10 } },
            ];
          }
          return [];
        },
      },
    };
    const notifications = {
      findUserIdsByRoleAndCenter: async () => ['u1'],
      findUserIdsByRoleAndDistrict: async () => ['u2'],
      createForMultipleUsers: async (_ids: string[], data: { type: string }) => {
        created.push(data);
        return 1;
      },
    };

    await new NotificationCronService(prisma as never, notifications as never).handleDailyNotifications();

    eq(
      created.some((c) => c.type === 'attendance_absence' || c.type === 'attendance_low_rate'),
      false,
    );
  });

  console.log('\nAll notification cron tests passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

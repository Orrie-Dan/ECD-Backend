/**
 * Daily notification cron tests.
 * Run: npx ts-node src/modules/notifications/__tests__/notification-cron.service.spec.ts
 */
import { NotificationCronService } from '../notification-cron.service';
import { NotificationDedupeKeys } from '../notification-dedupe';
import { attendanceLookbackRange } from '../../alerts/attendance-alert.constants';

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
      referral: { findMany: async () => [] },
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
            center: { name: 'Center 1', districtId: 'd1', district: { name: 'District 1' } },
            nutritionScreenings: [{ id: 'ns1', screeningDate: new Date() }],
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

    await new NotificationCronService(
      prisma as never,
      notifications as never,
    ).handleDailyNotifications();

    const types = created.map((c) => c.type);
    eq(types.includes('attendance_absence'), true);
    eq(types.includes('attendance_low_rate'), true);

    const absence = created.find((c) => c.type === 'attendance_absence');
    eq(absence?.entityId, 'ch1');
    eq(absence?.metadata?.code, 'ATTENDANCE_ABSENCE_RISK');
    eq(absence?.metadata?.absentDays, 4);
    eq(typeof (absence as { dedupeKey?: string })?.dedupeKey, 'string');

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
      referral: { findMany: async () => [] },
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

    await new NotificationCronService(
      prisma as never,
      notifications as never,
    ).handleDailyNotifications();

    eq(
      created.some((c) => c.type === 'attendance_absence' || c.type === 'attendance_low_rate'),
      false,
    );
  });

  await assert('repeated cron run passes stable dedupe keys', async () => {
    const created: Array<{ type: string; dedupeKey?: string }> = [];
    const prisma = {
      stedAssessment: { findMany: async () => [] },
      complianceAssessmentItem: { findMany: async () => [] },
      childTransfer: { findMany: async () => [] },
      referral: { findMany: async () => [] },
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
            center: { name: 'Center 1', districtId: 'd1', district: { name: 'District 1' } },
            nutritionScreenings: [{ id: 'ns1', screeningDate: new Date() }],
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

    const storedKeys = new Set<string>();
    const notifications = {
      findUserIdsByRoleAndCenter: async () => ['u-center'],
      findUserIdsByRoleAndDistrict: async () => ['u-district'],
      createForMultipleUsers: async (
        _userIds: string[],
        data: { type: string; dedupeKey?: string },
      ) => {
        if (!data.dedupeKey) {
          created.push(data);
          return 1;
        }
        if (storedKeys.has(data.dedupeKey)) {
          return 0;
        }
        storedKeys.add(data.dedupeKey);
        created.push(data);
        return 1;
      },
    };

    const cron = new NotificationCronService(prisma as never, notifications as never);
    await cron.handleDailyNotifications();
    await cron.handleDailyNotifications();

    const absenceKeys = created
      .filter((c) => c.type === 'attendance_absence')
      .map((c) => c.dedupeKey);
    eq(absenceKeys.length, 1);
    const { to } = attendanceLookbackRange();
    eq(absenceKeys[0], NotificationDedupeKeys.attendanceAbsenceCron('ch1', to));

    const lowRateCount = created.filter((c) => c.type === 'attendance_low_rate').length;
    eq(lowRateCount, 1);
  });

  await assert('new attendance window produces new dedupe key', async () => {
    const window1 = new Date('2026-09-02T00:00:00.000Z');
    const window2 = new Date('2026-09-09T00:00:00.000Z');
    const key1 = NotificationDedupeKeys.attendanceAbsenceCron('ch1', window1);
    const key2 = NotificationDedupeKeys.attendanceAbsenceCron('ch1', window2);
    eq(key1 === key2, false);
  });

  await assert('cron logs rejected branch and continues successful branches', async () => {
    const created: Array<{ type: string }> = [];
    const errorCalls: unknown[][] = [];

    const dueSoon = new Date();

    const prisma = {
      stedAssessment: {
        findMany: async () => [
          {
            id: 'sted-1',
            centerId: 'c-sted',
            childId: 'ch-sted',
            followUpDueDate: dueSoon,
            child: { firstName: 'A', lastName: 'B' },
          },
        ],
      },
      complianceAssessmentItem: { findMany: async () => [] },
      childTransfer: { findMany: async () => [] },
      referral: { findMany: async () => [] },
      ecdCenter: {
        findMany: async (args: any) => {
          if (args?.select?.capacity !== undefined) {
            throw new Error('capacity boom');
          }
          return [];
        },
      },
      child: { findMany: async () => [] },
      attendanceRecord: {
        groupBy: async (args?: { by?: string[] }) => {
          const by = args?.by ?? [];
          if (by.includes('childId')) return [];
          if (by.includes('centerId')) return [];
          return [];
        },
      },
    };

    const notifications = {
      findUserIdsByRoleAndCenter: async () => ['u1'],
      findUserIdsByRoleAndDistrict: async () => ['u2'],
      createForMultipleUsers: async (_ids: string[], data: { type: string }) => {
        created.push({ type: data.type });
        return 1;
      },
    };

    const cron = new NotificationCronService(prisma as never, notifications as never);
    (cron as any).logger = {
      log: () => {},
      error: (...args: unknown[]) => errorCalls.push(args),
    };

    await cron.handleDailyNotifications();

    eq(
      created.some((c) => c.type === 'sted_followup'),
      true,
    );
    eq(errorCalls.length > 0, true);
    const [message] = errorCalls[0] as [string, unknown];
    if (!String(message).includes('capacity_warnings')) {
      throw new Error(`Expected capacity_warnings in error log; got ${String(message)}`);
    }
  });

  await assert('cron surfaces multiple failed branches independently', async () => {
    const errorCalls: unknown[][] = [];
    const created: Array<{ type: string }> = [];

    const prisma = {
      stedAssessment: { findMany: async () => [] },
      complianceAssessmentItem: { findMany: async () => [] },
      childTransfer: { findMany: async () => [] },
      referral: { findMany: async () => [] },
      ecdCenter: {
        findMany: async (args: any) => {
          if (args?.select?.capacity !== undefined) {
            throw new Error('capacity boom');
          }
          return [];
        },
      },
      child: { findMany: async () => [] },
      attendanceRecord: {
        groupBy: async (args?: { by?: string[] }) => {
          const by = args?.by ?? [];
          if (by.includes('childId')) return [];
          if (by.includes('centerId')) {
            throw new Error('low rate boom');
          }
          return [];
        },
      },
    };

    const notifications = {
      findUserIdsByRoleAndCenter: async () => ['u1'],
      findUserIdsByRoleAndDistrict: async () => ['u2'],
      createForMultipleUsers: async (_ids: string[], data: { type: string }) => {
        created.push({ type: data.type });
        return 1;
      },
    };

    const cron = new NotificationCronService(prisma as never, notifications as never);
    (cron as any).logger = {
      log: () => {},
      error: (...args: unknown[]) => errorCalls.push(args),
    };

    await cron.handleDailyNotifications();

    // No successful branches create inbox rows in this configuration.
    eq(created.length, 0);
    eq(errorCalls.length >= 2, true);
    const messages = errorCalls.map((c) => String(c[0]));
    if (!messages.some((m) => m.includes('capacity_warnings'))) {
      throw new Error(`Expected capacity_warnings error; got ${messages.join(' | ')}`);
    }
    if (!messages.some((m) => m.includes('attendance_low_rate'))) {
      throw new Error(`Expected attendance_low_rate error; got ${messages.join(' | ')}`);
    }
  });

  await assert('cron successful run does not emit error logs', async () => {
    const errorCalls: unknown[][] = [];

    const prisma = {
      stedAssessment: { findMany: async () => [] },
      complianceAssessmentItem: { findMany: async () => [] },
      childTransfer: { findMany: async () => [] },
      referral: { findMany: async () => [] },
      ecdCenter: { findMany: async () => [] },
      child: { findMany: async () => [] },
      attendanceRecord: {
        groupBy: async () => [],
      },
    };

    const notifications = {
      findUserIdsByRoleAndCenter: async () => ['u1'],
      findUserIdsByRoleAndDistrict: async () => ['u2'],
      createForMultipleUsers: async () => 0,
    };

    const cron = new NotificationCronService(prisma as never, notifications as never);
    (cron as any).logger = {
      log: () => {},
      error: (...args: unknown[]) => errorCalls.push(args),
    };

    await cron.handleDailyNotifications();

    eq(errorCalls.length, 0);
  });

  console.log('\nAll notification cron tests passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

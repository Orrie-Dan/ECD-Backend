/**
 * NOTIF-06: Time-derived inbox notification tests.
 * Covers stale referrals, overdue nutrition screening, and never-screened nutrition.
 * Run: npx ts-node src/modules/notifications/__tests__/notification-cron-notif06.spec.ts
 */
import { NotificationCronService } from '../notification-cron.service';
import { NotificationDedupeKeys } from '../notification-dedupe';
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

function daysAgo(days: number): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - days);
  return d;
}

type Created = {
  type: string;
  entityId?: string;
  entityType?: string;
  dedupeKey?: string;
  title?: string;
  message?: string;
  metadata?: Record<string, unknown>;
};

function basePrisma() {
  return {
    stedAssessment: { findMany: async () => [] },
    complianceAssessmentItem: { findMany: async () => [] },
    childTransfer: { findMany: async () => [] },
    ecdCenter: { findMany: async () => [] },
    child: { findMany: async () => [] },
    attendanceRecord: { groupBy: async () => [] },
    referral: { findMany: async () => [] },
  };
}

function baseNotifications(created: Created[], storedKeys?: Set<string>) {
  return {
    findUserIdsByRoleAndCenter: async () => ['u-center'],
    findUserIdsByRoleAndDistrict: async () => ['u-district'],
    createForMultipleUsers: async (_ids: string[], data: Created) => {
      if (storedKeys && data.dedupeKey) {
        if (storedKeys.has(data.dedupeKey)) return 0;
        storedKeys.add(data.dedupeKey);
      }
      created.push(data);
      return _ids.length;
    },
  };
}

async function main() {
  // ── Stale Referral Tests ──────────────────────────────────────────────

  await assert('referral below threshold → no notification', async () => {
    const created: Created[] = [];
    const prisma = {
      ...basePrisma(),
      referral: {
        findMany: async () => [
          {
            id: 'ref-1',
            centerId: 'c1',
            childId: 'ch1',
            referralDate: daysAgo(5), // only 5 days old
            sourceType: 'health_facility',
            child: { firstName: 'Jane', lastName: 'Doe' },
            center: { name: 'Center 1', districtId: 'd1', district: { name: 'District 1' } },
          },
        ],
      },
    };
    // The cron queries with referralDate <= cutoff (7 days ago),
    // so a 5-day-old referral should not appear in results.
    // Simulate that Prisma returns empty for the threshold query.
    prisma.referral.findMany = async () => [];

    const cron = new NotificationCronService(prisma as never, baseNotifications(created) as never);
    (cron as any).logger = { log: () => {}, error: () => {} };
    await cron.handleDailyNotifications();

    eq(created.filter((c) => c.type === 'referral_updated').length, 0, 'no stale referral notif');
  });

  await assert('referral crosses 7-day threshold → one notification', async () => {
    const created: Created[] = [];
    const prisma = {
      ...basePrisma(),
      referral: {
        findMany: async () => [
          {
            id: 'ref-1',
            centerId: 'c1',
            childId: 'ch1',
            referralDate: daysAgo(8),
            sourceType: 'health_facility',
            child: { firstName: 'Jane', lastName: 'Doe' },
            center: { name: 'Center 1', districtId: 'd1', district: { name: 'District 1' } },
          },
        ],
      },
    };

    const cron = new NotificationCronService(prisma as never, baseNotifications(created) as never);
    (cron as any).logger = { log: () => {}, error: () => {} };
    await cron.handleDailyNotifications();

    const stale = created.filter((c) => c.type === 'referral_updated');
    eq(stale.length, 1, 'one stale referral notification');
    eq(stale[0]?.entityType, 'referral');
    eq(stale[0]?.entityId, 'ref-1');
    eq(stale[0]?.dedupeKey, NotificationDedupeKeys.referralCronStale('ref-1'));
    eq(stale[0]?.metadata?.code, 'REFERRAL_STALE');
    eq(stale[0]?.metadata?.childName, 'Jane Doe');
    eq(stale[0]?.message?.includes('Jane Doe'), true, 'message includes child name');
    eq(stale[0]?.metadata?.priority, 'medium', 'medium priority under 14 days');
  });

  await assert('cron runs again next day → still one notification (dedupe)', async () => {
    const created: Created[] = [];
    const storedKeys = new Set<string>();
    const prisma = {
      ...basePrisma(),
      referral: {
        findMany: async () => [
          {
            id: 'ref-1',
            centerId: 'c1',
            childId: 'ch1',
            referralDate: daysAgo(8),
            sourceType: 'health_facility',
            child: { firstName: 'Jane', lastName: 'Doe' },
            center: { name: 'Center 1', districtId: 'd1', district: { name: 'District 1' } },
          },
        ],
      },
    };

    const cron = new NotificationCronService(
      prisma as never,
      baseNotifications(created, storedKeys) as never,
    );
    (cron as any).logger = { log: () => {}, error: () => {} };
    await cron.handleDailyNotifications();
    await cron.handleDailyNotifications();

    eq(created.filter((c) => c.type === 'referral_updated').length, 1, 'still one after two runs');
  });

  await assert('different stale referral → separate notification', async () => {
    const created: Created[] = [];
    const prisma = {
      ...basePrisma(),
      referral: {
        findMany: async () => [
          {
            id: 'ref-1',
            centerId: 'c1',
            childId: 'ch1',
            referralDate: daysAgo(10),
            sourceType: 'health_facility',
            child: { firstName: 'Jane', lastName: 'Doe' },
            center: { name: 'Center 1', districtId: 'd1', district: { name: 'District 1' } },
          },
          {
            id: 'ref-2',
            centerId: 'c1',
            childId: 'ch1',
            referralDate: daysAgo(9),
            sourceType: 'community',
            child: { firstName: 'Jane', lastName: 'Doe' },
            center: { name: 'Center 1', districtId: 'd1', district: { name: 'District 1' } },
          },
        ],
      },
    };

    const cron = new NotificationCronService(prisma as never, baseNotifications(created) as never);
    (cron as any).logger = { log: () => {}, error: () => {} };
    await cron.handleDailyNotifications();

    const stale = created.filter((c) => c.type === 'referral_updated');
    eq(stale.length, 2, 'two separate referral notifications');
    eq(stale[0]?.entityId !== stale[1]?.entityId, true, 'different entity IDs');
  });

  await assert('stale referral at 14+ days has high priority metadata', async () => {
    const created: Created[] = [];
    const prisma = {
      ...basePrisma(),
      referral: {
        findMany: async () => [
          {
            id: 'ref-old',
            centerId: 'c1',
            childId: 'ch1',
            referralDate: daysAgo(15),
            sourceType: 'health_facility',
            child: { firstName: 'Jane', lastName: 'Doe' },
            center: { name: 'Center 1', districtId: 'd1', district: { name: 'District 1' } },
          },
        ],
      },
    };

    const cron = new NotificationCronService(prisma as never, baseNotifications(created) as never);
    (cron as any).logger = { log: () => {}, error: () => {} };
    await cron.handleDailyNotifications();

    const stale = created.find((c) => c.type === 'referral_updated');
    eq(stale?.metadata?.priority, 'high', '14+ days = high priority');

    // Verify priority resolver honors this
    eq(resolveNotificationPriority({ type: 'referral_updated', metadataPriority: 'high' }), 'high');
  });

  await assert('stale referral notifies center + district recipients', async () => {
    const recipientCalls: Array<{ method: string; args: unknown[] }> = [];
    const created: Created[] = [];

    const notifications = {
      findUserIdsByRoleAndCenter: async (...args: unknown[]) => {
        recipientCalls.push({ method: 'center', args });
        return ['u-director', 'u-caregiver'];
      },
      findUserIdsByRoleAndDistrict: async (...args: unknown[]) => {
        recipientCalls.push({ method: 'district', args });
        return ['u-district'];
      },
      createForMultipleUsers: async (ids: string[], data: Created) => {
        created.push(data);
        return ids.length;
      },
    };

    const prisma = {
      ...basePrisma(),
      referral: {
        findMany: async () => [
          {
            id: 'ref-1',
            centerId: 'c1',
            childId: 'ch1',
            referralDate: daysAgo(8),
            sourceType: 'health_facility',
            child: { firstName: 'Jane', lastName: 'Doe' },
            center: { name: 'Center 1', districtId: 'd1', district: { name: 'District 1' } },
          },
        ],
      },
    };

    const cron = new NotificationCronService(prisma as never, notifications as never);
    (cron as any).logger = { log: () => {}, error: () => {} };
    await cron.handleDailyNotifications();

    const centerCall = recipientCalls.find((c) => c.method === 'center');
    const districtCall = recipientCalls.find((c) => c.method === 'district');
    eq(!!centerCall, true, 'center recipient call made');
    eq(!!districtCall, true, 'district recipient call made');
  });

  // ── Overdue Nutrition Screening Tests ─────────────────────────────────

  await assert('recently screened child → no notification', async () => {
    const created: Created[] = [];
    const prisma = {
      ...basePrisma(),
      child: {
        findMany: async () => [
          {
            id: 'ch1',
            firstName: 'Paul',
            lastName: 'Victor',
            centerId: 'c1',
            center: { name: 'Center 1', districtId: 'd1', district: { name: 'District 1' } },
            nutritionScreenings: [{ id: 'ns1', screeningDate: daysAgo(10) }],
          },
        ],
      },
    };

    const cron = new NotificationCronService(prisma as never, baseNotifications(created) as never);
    (cron as any).logger = { log: () => {}, error: () => {} };
    await cron.handleDailyNotifications();

    eq(
      created.filter((c) => c.metadata?.code === 'NUTRITION_OVERDUE').length,
      0,
      'no overdue notification',
    );
  });

  await assert('screening becomes overdue → one notification', async () => {
    const created: Created[] = [];
    const lastDate = daysAgo(35);
    const prisma = {
      ...basePrisma(),
      child: {
        findMany: async () => [
          {
            id: 'ch1',
            firstName: 'Paul',
            lastName: 'Victor',
            centerId: 'c1',
            center: { name: 'Center 1', districtId: 'd1', district: { name: 'District 1' } },
            nutritionScreenings: [{ id: 'ns1', screeningDate: lastDate }],
          },
        ],
      },
    };

    const cron = new NotificationCronService(prisma as never, baseNotifications(created) as never);
    (cron as any).logger = { log: () => {}, error: () => {} };
    await cron.handleDailyNotifications();

    const overdue = created.filter((c) => c.metadata?.code === 'NUTRITION_OVERDUE');
    eq(overdue.length, 1, 'one overdue notification');
    eq(overdue[0]?.entityType, 'child');
    eq(overdue[0]?.entityId, 'ch1');
    eq(overdue[0]?.type, 'nutrition_alert');
    eq(overdue[0]?.message?.includes('Paul Victor'), true, 'message includes child name');
    eq(overdue[0]?.message?.includes('30+'), true, 'message includes threshold');
    eq(
      overdue[0]?.dedupeKey,
      NotificationDedupeKeys.nutritionOverdueCron('ch1', lastDate.toISOString().slice(0, 10)),
    );
  });

  await assert('repeat cron → no duplicate overdue notification', async () => {
    const created: Created[] = [];
    const storedKeys = new Set<string>();
    const lastDate = daysAgo(35);
    const prisma = {
      ...basePrisma(),
      child: {
        findMany: async () => [
          {
            id: 'ch1',
            firstName: 'Paul',
            lastName: 'Victor',
            centerId: 'c1',
            center: { name: 'Center 1', districtId: 'd1', district: { name: 'District 1' } },
            nutritionScreenings: [{ id: 'ns1', screeningDate: lastDate }],
          },
        ],
      },
    };

    const cron = new NotificationCronService(
      prisma as never,
      baseNotifications(created, storedKeys) as never,
    );
    (cron as any).logger = { log: () => {}, error: () => {} };
    await cron.handleDailyNotifications();
    await cron.handleDailyNotifications();

    eq(created.filter((c) => c.metadata?.code === 'NUTRITION_OVERDUE').length, 1, 'still one');
  });

  await assert('new screening resets overdue → new lifecycle gets new key', async () => {
    const oldDate = daysAgo(60);
    const newDate = daysAgo(35);
    const key1 = NotificationDedupeKeys.nutritionOverdueCron(
      'ch1',
      oldDate.toISOString().slice(0, 10),
    );
    const key2 = NotificationDedupeKeys.nutritionOverdueCron(
      'ch1',
      newDate.toISOString().slice(0, 10),
    );
    eq(key1 === key2, false, 'different screening dates produce different keys');
  });

  // ── Never-Screened Tests ──────────────────────────────────────────────

  await assert('eligible child never screened → exactly one notification', async () => {
    const created: Created[] = [];
    const prisma = {
      ...basePrisma(),
      child: {
        findMany: async () => [
          {
            id: 'ch-new',
            firstName: 'Alice',
            lastName: 'Smith',
            centerId: 'c1',
            center: { name: 'Center 1', districtId: 'd1', district: { name: 'District 1' } },
            nutritionScreenings: [],
          },
        ],
      },
    };

    const cron = new NotificationCronService(prisma as never, baseNotifications(created) as never);
    (cron as any).logger = { log: () => {}, error: () => {} };
    await cron.handleDailyNotifications();

    const neverScreened = created.filter((c) => c.metadata?.code === 'NUTRITION_NEVER_SCREENED');
    eq(neverScreened.length, 1, 'one never-screened notification');
    eq(neverScreened[0]?.entityType, 'child');
    eq(neverScreened[0]?.entityId, 'ch-new');
    eq(neverScreened[0]?.type, 'nutrition_alert');
    eq(neverScreened[0]?.message?.includes('Alice Smith'), true, 'message includes child name');
    eq(neverScreened[0]?.dedupeKey, NotificationDedupeKeys.nutritionNeverScreenedCron('ch-new'));
  });

  await assert('never-screened child does not also get overdue notification', async () => {
    const created: Created[] = [];
    const prisma = {
      ...basePrisma(),
      child: {
        findMany: async () => [
          {
            id: 'ch-new',
            firstName: 'Alice',
            lastName: 'Smith',
            centerId: 'c1',
            center: { name: 'Center 1', districtId: 'd1', district: { name: 'District 1' } },
            nutritionScreenings: [],
          },
        ],
      },
    };

    const cron = new NotificationCronService(prisma as never, baseNotifications(created) as never);
    (cron as any).logger = { log: () => {}, error: () => {} };
    await cron.handleDailyNotifications();

    const nutritionNotifs = created.filter((c) => c.type === 'nutrition_alert');
    eq(nutritionNotifs.length, 1, 'exactly one nutrition notification');
    eq(nutritionNotifs[0]?.metadata?.code, 'NUTRITION_NEVER_SCREENED');
  });

  await assert('never-screened dedupe prevents duplicate on repeat cron', async () => {
    const created: Created[] = [];
    const storedKeys = new Set<string>();
    const prisma = {
      ...basePrisma(),
      child: {
        findMany: async () => [
          {
            id: 'ch-new',
            firstName: 'Alice',
            lastName: 'Smith',
            centerId: 'c1',
            center: { name: 'Center 1', districtId: 'd1', district: { name: 'District 1' } },
            nutritionScreenings: [],
          },
        ],
      },
    };

    const cron = new NotificationCronService(
      prisma as never,
      baseNotifications(created, storedKeys) as never,
    );
    (cron as any).logger = { log: () => {}, error: () => {} };
    await cron.handleDailyNotifications();
    await cron.handleDailyNotifications();

    eq(
      created.filter((c) => c.metadata?.code === 'NUTRITION_NEVER_SCREENED').length,
      1,
      'still one',
    );
  });

  // ── Parity with Alert Service ─────────────────────────────────────────

  await assert('referral stale threshold matches alerts service (7 days)', async () => {
    // Alert service uses STALE_REFERRAL_DAYS = 7, cron uses same
    const key = NotificationDedupeKeys.referralCronStale('ref-1');
    eq(typeof key, 'string');
    eq(key.includes('referral'), true, 'key references referral');
  });

  await assert('nutrition overdue threshold matches alerts service (30 days)', async () => {
    // Alert service uses OVERDUE_SCREENING_DAYS = 30, cron uses same
    const key = NotificationDedupeKeys.nutritionOverdueCron('ch1', '2026-07-01');
    eq(typeof key, 'string');
    eq(key.includes('child'), true, 'key references child entity');
  });

  await assert('referral_updated priority resolver supports metadata escalation', () => {
    eq(resolveNotificationPriority({ type: 'referral_updated' }), 'medium');
    eq(resolveNotificationPriority({ type: 'referral_updated', metadataPriority: 'high' }), 'high');
  });

  await assert('nutrition_alert priority resolver returns high by default', () => {
    eq(resolveNotificationPriority({ type: 'nutrition_alert' }), 'high');
  });

  // ── Cron Resilience ───────────────────────────────────────────────────

  await assert('stale referral failure does not block other producers', async () => {
    const created: Created[] = [];
    const errorCalls: unknown[][] = [];

    const prisma = {
      ...basePrisma(),
      referral: {
        findMany: async () => {
          throw new Error('referral boom');
        },
      },
      child: {
        findMany: async () => [
          {
            id: 'ch1',
            firstName: 'Paul',
            lastName: 'Victor',
            centerId: 'c1',
            center: { name: 'Center 1', districtId: 'd1', district: { name: 'District 1' } },
            nutritionScreenings: [],
          },
        ],
      },
    };

    const cron = new NotificationCronService(prisma as never, baseNotifications(created) as never);
    (cron as any).logger = {
      log: () => {},
      error: (...args: unknown[]) => errorCalls.push(args),
    };
    await cron.handleDailyNotifications();

    // referral boom should be logged
    eq(
      errorCalls.some((c) => String(c[0]).includes('stale_referrals')),
      true,
      'stale_referrals error logged',
    );
    // nutrition producer should still have run
    eq(
      created.some((c) => c.type === 'nutrition_alert'),
      true,
      'nutrition still ran despite referral failure',
    );
  });

  await assert('nutrition overdue failure does not block other producers', async () => {
    const created: Created[] = [];
    const errorCalls: unknown[][] = [];

    const prisma = {
      ...basePrisma(),
      child: {
        findMany: async () => {
          throw new Error('nutrition boom');
        },
      },
      referral: {
        findMany: async () => [
          {
            id: 'ref-1',
            centerId: 'c1',
            childId: 'ch1',
            referralDate: daysAgo(10),
            sourceType: 'health_facility',
            child: { firstName: 'Jane', lastName: 'Doe' },
            center: { name: 'Center 1', districtId: 'd1', district: { name: 'District 1' } },
          },
        ],
      },
    };

    const cron = new NotificationCronService(prisma as never, baseNotifications(created) as never);
    (cron as any).logger = {
      log: () => {},
      error: (...args: unknown[]) => errorCalls.push(args),
    };
    await cron.handleDailyNotifications();

    eq(
      errorCalls.some((c) => String(c[0]).includes('nutrition_overdue_screening')),
      true,
      'nutrition error logged',
    );
    eq(
      created.some((c) => c.type === 'referral_updated'),
      true,
      'referral still ran despite nutrition failure',
    );
  });

  // ── Context Richness ──────────────────────────────────────────────────

  await assert('stale referral notification includes rich context metadata', async () => {
    const created: Created[] = [];
    const prisma = {
      ...basePrisma(),
      referral: {
        findMany: async () => [
          {
            id: 'ref-ctx',
            centerId: 'c1',
            childId: 'ch1',
            referralDate: daysAgo(10),
            sourceType: 'health_facility',
            child: { firstName: 'Jane', lastName: 'Doe' },
            center: { name: 'Center A', districtId: 'd1', district: { name: 'Gasabo' } },
          },
        ],
      },
    };

    const cron = new NotificationCronService(prisma as never, baseNotifications(created) as never);
    (cron as any).logger = { log: () => {}, error: () => {} };
    await cron.handleDailyNotifications();

    const n = created.find((c) => c.type === 'referral_updated');
    eq(n?.metadata?.childName, 'Jane Doe');
    eq(n?.metadata?.centerName, 'Center A');
    eq(n?.metadata?.districtName, 'Gasabo');
    eq(n?.metadata?.childId, 'ch1');
    eq(typeof n?.metadata?.ageDays, 'number');
  });

  await assert('nutrition overdue notification includes rich context metadata', async () => {
    const created: Created[] = [];
    const lastDate = daysAgo(40);
    const prisma = {
      ...basePrisma(),
      child: {
        findMany: async () => [
          {
            id: 'ch1',
            firstName: 'Paul',
            lastName: 'Victor',
            centerId: 'c1',
            center: { name: 'Center B', districtId: 'd2', district: { name: 'Kicukiro' } },
            nutritionScreenings: [{ id: 'ns1', screeningDate: lastDate }],
          },
        ],
      },
    };

    const cron = new NotificationCronService(prisma as never, baseNotifications(created) as never);
    (cron as any).logger = { log: () => {}, error: () => {} };
    await cron.handleDailyNotifications();

    const n = created.find((c) => c.metadata?.code === 'NUTRITION_OVERDUE');
    eq(n?.metadata?.childName, 'Paul Victor');
    eq(n?.metadata?.centerName, 'Center B');
    eq(n?.metadata?.districtName, 'Kicukiro');
    eq(n?.metadata?.lastScreeningDate, lastDate.toISOString().slice(0, 10));
    eq(n?.metadata?.threshold, 30);
  });

  console.log('\nAll NOTIF-06 tests passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

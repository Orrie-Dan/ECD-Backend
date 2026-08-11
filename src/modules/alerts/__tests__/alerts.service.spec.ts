/**
 * Follow-up alerts tests.
 * Run: npx ts-node src/modules/alerts/__tests__/alerts.service.spec.ts
 */
import { UserRole } from '@prisma/client';
import { AuthUser } from '../../auth/interfaces/jwt-payload.interface';
import { AlertsService } from '../alerts.service';

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
    id: 'u1',
    username: 'u',
    email: null,
    fullName: 'U',
    role: partial.role,
    centerId: partial.centerId ?? null,
    districtId: partial.districtId ?? null,
    status: 'active',
  };
}

async function main() {
  await assert('emits nutrition, attendance, referral, data-quality alerts', async () => {
    const oldDate = new Date('2026-01-01');
    let childCalls = 0;

    const prisma = {
      ecdCenter: {
        findMany: async () => [
          {
            id: 'c1',
            name: 'Center 1',
          },
        ],
        findFirst: async () => ({ id: 'c1', districtId: 'd1' }),
      },
      child: {
        findMany: async (args?: { select?: Record<string, unknown> }) => {
          childCalls += 1;
          const select = args?.select ?? {};
          if (select.nutritionScreenings) {
            return [
              {
                id: 'child-severe',
                firstName: 'Ada',
                lastName: 'L',
                centerId: 'c1',
                center: { name: 'Center 1' },
                nutritionScreenings: [
                  {
                    id: 'scr-1',
                    screeningDate: new Date(),
                    nutritionStatus: 'severe',
                    requiresReferral: true,
                  },
                ],
              },
              {
                id: 'child-overdue',
                firstName: 'Bob',
                lastName: 'M',
                centerId: 'c1',
                center: { name: 'Center 1' },
                nutritionScreenings: [
                  {
                    id: 'scr-2',
                    screeningDate: oldDate,
                    nutritionStatus: 'normal',
                    requiresReferral: false,
                  },
                ],
              },
            ];
          }
          if (select.guardianPhone) {
            return [
              {
                id: 'child-phone',
                firstName: 'Cara',
                lastName: 'N',
                centerId: 'c1',
                center: { name: 'Center 1' },
                guardianPhone: '',
              },
            ];
          }
          // attendance child hydrate
          return [
            {
              id: 'child-abs',
              firstName: 'Dan',
              lastName: 'O',
              centerId: 'c1',
              center: { name: 'Center 1' },
            },
          ];
        },
      },
      attendanceRecord: {
        groupBy: async () => [{ childId: 'child-abs', _count: { _all: 4 } }],
      },
      referral: {
        findMany: async () => [
          {
            id: 'ref-1',
            childId: 'child-severe',
            centerId: 'c1',
            referralDate: oldDate,
            sourceType: 'nutrition',
            child: { firstName: 'Ada', lastName: 'L' },
            center: { name: 'Center 1' },
          },
        ],
      },
    };

    const result = await new AlertsService(prisma as never).getFollowUpAlerts(
      user({ role: UserRole.district_focal_person, districtId: 'd1' }),
      { category: 'all', limit: 100 },
    );

    const codes = new Set(result.items.map((i) => i.code));
    eq(codes.has('NUTRITION_SEVERE'), true);
    eq(codes.has('NUTRITION_REQUIRES_REFERRAL'), true);
    eq(codes.has('NUTRITION_OVERDUE'), true);
    eq(codes.has('ATTENDANCE_ABSENCE_RISK'), true);
    eq(codes.has('REFERRAL_FOLLOW_UP'), true);
    eq(codes.has('DQ_MISSING_GUARDIAN_PHONE'), true);
    eq(codes.has('DQ_NO_ATTENDANCE_TODAY'), true);
    eq(result.counts.high > 0, true);
    eq(childCalls > 0, true);
  });

  await assert('category filter returns only nutrition', async () => {
    const prisma = {
      ecdCenter: {
        findMany: async () => [{ id: 'c1' }],
        findFirst: async () => ({ id: 'c1', districtId: 'd1' }),
      },
      child: {
        findMany: async () => [
          {
            id: 'child-1',
            firstName: 'Eve',
            lastName: 'P',
            centerId: 'c1',
            center: { name: 'C' },
            nutritionScreenings: [
              {
                id: 's1',
                screeningDate: new Date(),
                nutritionStatus: 'severe',
                requiresReferral: false,
              },
            ],
            guardianPhone: '078',
          },
        ],
      },
      attendanceRecord: { groupBy: async () => [] },
      referral: { findMany: async () => [] },
    };

    const result = await new AlertsService(prisma as never).getFollowUpAlerts(
      user({ role: UserRole.ncda_admin }),
      { category: 'nutrition', centerId: 'c1' },
    );

    eq(
      result.items.every((i) => i.category === 'nutrition'),
      true,
    );
    eq(result.counts.attendance, 0);
  });

  await assert('empty district yields empty alerts', async () => {
    const prisma = {
      ecdCenter: { findMany: async () => [] },
      child: { findMany: async () => [] },
      attendanceRecord: { groupBy: async () => [] },
      referral: { findMany: async () => [] },
    };
    const result = await new AlertsService(prisma as never).getFollowUpAlerts(
      user({ role: UserRole.district_focal_person, districtId: 'empty' }),
      {},
    );
    eq(result.total, 0);
    eq(result.items.length, 0);
  });

  console.log('\nAll alerts tests passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

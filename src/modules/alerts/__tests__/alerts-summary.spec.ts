/**
 * Follow-up summary aggregation tests.
 * Run: npx ts-node src/modules/alerts/__tests__/alerts-summary.spec.ts
 */
import { UserRole } from '../../../common/domain';
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
  await assert('summary groups nutrition alerts by province', async () => {
    const prisma = {
      ecdCenter: {
        findMany: async (args?: { where?: { id?: { in?: string[] } }; select?: unknown }) => {
          if (args?.where?.id?.in) {
            return [
              {
                id: 'c1',
                name: 'Center 1',
                districtId: 'd1',
                villageId: 'v1',
                district: {
                  id: 'd1',
                  name: 'Gasabo',
                  provinceId: 'p1',
                  province: { id: 'p1', name: 'Kigali City' },
                },
              },
            ];
          }
          return [{ id: 'c1', name: 'Center 1' }];
        },
        findFirst: async () => ({ id: 'c1', districtId: 'd1' }),
      },
      administrativeUnit: {
        findMany: async () => [
          { id: 'v1', level: 'village', parentId: 'cell1', name: 'Village' },
          { id: 'cell1', level: 'cell', parentId: 's1', name: 'Cell' },
          { id: 's1', level: 'sector', parentId: null, name: 'Kimironko' },
        ],
        findUnique: async () => ({ id: 's1', level: 'sector' }),
      },
      district: {
        findMany: async () => [{ id: 'd1' }],
        findFirst: async () => ({ provinceId: 'p1' }),
      },
      child: {
        findMany: async () => [
          {
            id: 'child-1',
            firstName: 'Ada',
            lastName: 'L',
            centerId: 'c1',
            center: { name: 'Center 1' },
            nutritionScreenings: [
              {
                id: 'scr-1',
                screeningDate: new Date('2026-08-01'),
                nutritionStatus: 'severe',
                requiresReferral: true,
              },
            ],
          },
        ],
      },
      attendanceRecord: { groupBy: async () => [] },
      referral: { findMany: async () => [] },
      stedAssessment: { findMany: async () => [] },
      childTransfer: { findMany: async () => [] },
      complianceAssessmentItem: { findMany: async () => [] },
    };

    const result = await new AlertsService(prisma as never).getFollowUpSummary(
      user({ role: UserRole.ncda_admin }),
      { groupBy: 'province', category: 'nutrition' },
    );

    eq(result.groupBy, 'province');
    eq(result.items.length, 1);
    eq(result.items[0]?.id, 'p1');
    eq(result.items[0]?.name, 'Kigali City');
    eq(result.items[0]?.total >= 1, true);
    eq(result.items[0]?.categoryCounts.nutrition >= 1, true);
  });

  await assert('summary respects priority filter', async () => {
    const prisma = {
      ecdCenter: {
        findMany: async (args?: { where?: { id?: { in?: string[] } } }) => {
          if (args?.where?.id?.in) {
            return [
              {
                id: 'c1',
                name: 'Center 1',
                districtId: 'd1',
                villageId: 'v1',
                district: {
                  id: 'd1',
                  name: 'Gasabo',
                  provinceId: 'p1',
                  province: { id: 'p1', name: 'Kigali City' },
                },
              },
            ];
          }
          return [{ id: 'c1', name: 'Center 1' }];
        },
        findFirst: async () => ({ id: 'c1', districtId: 'd1' }),
      },
      administrativeUnit: {
        findMany: async () => [
          { id: 'v1', level: 'village', parentId: 's1', name: 'Village' },
          { id: 's1', level: 'sector', parentId: null, name: 'Kimironko' },
        ],
      },
      child: {
        findMany: async () => [
          {
            id: 'child-1',
            firstName: 'Ada',
            lastName: 'L',
            centerId: 'c1',
            center: { name: 'Center 1' },
            nutritionScreenings: [
              {
                id: 'scr-1',
                screeningDate: new Date('2026-08-01'),
                nutritionStatus: 'severe',
                requiresReferral: false,
              },
            ],
          },
        ],
      },
      attendanceRecord: { groupBy: async () => [] },
      referral: { findMany: async () => [] },
      stedAssessment: { findMany: async () => [] },
      childTransfer: { findMany: async () => [] },
      complianceAssessmentItem: { findMany: async () => [] },
    };

    const highOnly = await new AlertsService(prisma as never).getFollowUpSummary(
      user({ role: UserRole.ncda_admin }),
      { groupBy: 'center', category: 'nutrition', priority: 'low' },
    );
    eq(highOnly.totalAlerts, 0);
  });

  console.log('\nAll alerts summary tests passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

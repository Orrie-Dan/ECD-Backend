/**
 * District risk Phase 1 tests.
 * Run: npx ts-node src/modules/analytics/__tests__/district-risk.service.spec.ts
 */
import { UserRole } from '../../../common/domain';
import { ForbiddenException } from '@nestjs/common';
import {
  computeStedCoveragePct,
  interpretDistrictRisk,
  severityFromStedCoverage,
} from '../district-risk.policy';
import { DistrictRiskService } from '../district-risk.service';
import { AuthUser } from '../../auth/interfaces/jwt-payload.interface';

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
    username: 'u',
    email: null,
    fullName: 'U',
    role: partial.role,
    centerId: partial.centerId ?? null,
    districtId: partial.districtId ?? null,
    status: 'active',
  };
}

function createPrisma(options: {
  districts: Array<{ id: string; name: string; code: string; isActive: boolean }>;
  centers?: Record<string, number>;
  activeChildren?: Record<string, number>;
  attendance?: Record<string, { present: number; absent: number }>;
  nutrition?: Record<string, { screenings: number; severe: number }>;
  pendingReferrals?: Record<string, number>;
  sted?: Record<string, { assessmentsCompleted: number; childrenAssessed: number }>;
  stedFollowUps?: Record<string, number>;
}) {
  const stats = {
    districtFindMany: 0,
    queryRaw: 0,
  };

  const prisma = {
    stats,
    district: {
      findMany: async () => {
        stats.districtFindMany += 1;
        return options.districts;
      },
    },
    $queryRaw: async (strings: TemplateStringsArray) => {
      stats.queryRaw += 1;
      const sql = strings.join('?');

      if (sql.includes('LEFT JOIN ecd_center c ON c.district_id = d.id')) {
        return options.districts.map((d) => ({
          districtId: d.id,
          cnt: options.centers?.[d.id] ?? 0,
        }));
      }
      if (sql.includes('ch.status = CAST')) {
        return Object.entries(options.activeChildren ?? {}).map(([districtId, cnt]) => ({
          districtId,
          cnt,
        }));
      }
      if (sql.includes('attendance_record ar')) {
        return Object.entries(options.attendance ?? {}).map(([districtId, att]) => ({
          districtId,
          present: att.present,
          absent: att.absent,
        }));
      }
      if (sql.includes('child_nutrition_screening s')) {
        return Object.entries(options.nutrition ?? {}).map(([districtId, n]) => ({
          districtId,
          screenings: n.screenings,
          severe: n.severe,
        }));
      }
      if (sql.includes('FROM referral r')) {
        return Object.entries(options.pendingReferrals ?? {}).map(([districtId, cnt]) => ({
          districtId,
          cnt,
        }));
      }
      if (sql.includes('FROM sted_assessment s') && sql.includes('follow_up_in_6_months')) {
        return Object.entries(options.stedFollowUps ?? {}).map(([districtId, cnt]) => ({
          districtId,
          cnt,
        }));
      }
      if (sql.includes('FROM sted_assessment s')) {
        return Object.entries(options.sted ?? {}).map(([districtId, s]) => ({
          districtId,
          assessmentsCompleted: s.assessmentsCompleted,
          childrenAssessed: s.childrenAssessed,
        }));
      }
      throw new Error(`Unexpected queryRaw SQL: ${sql.slice(0, 120)}`);
    },
  };

  return prisma;
}

async function main() {
  await assert('policy: STED coverage uses childrenAssessed / activeChildren', () => {
    eq(computeStedCoveragePct(35, 100), 35);
    eq(computeStedCoveragePct(0, 0), null);
  });

  await assert('policy: STED bands on percentage scale', () => {
    eq(severityFromStedCoverage(75), 'normal');
    eq(severityFromStedCoverage(55), 'watch');
    eq(severityFromStedCoverage(40), 'concern');
    eq(severityFromStedCoverage(20), 'critical');
    eq(severityFromStedCoverage(null), null);
  });

  await assert('policy: inactive district is critical', () => {
    const result = interpretDistrictRisk({
      isActive: false,
      centersInScope: 2,
      activeChildren: 10,
      attendanceRecords: 0,
      stedCoveragePct: null,
      stedAssessmentsCompleted: 0,
    });
    eq(result.severity, 'critical');
    eq(result.primaryIssueCode, 'district_inactive');
  });

  await assert('returns one row per in-scope district', async () => {
    const service = new DistrictRiskService(
      createPrisma({
        districts: [
          { id: 'd1', name: 'Alpha', code: 'A', isActive: true },
          { id: 'd2', name: 'Beta', code: 'B', isActive: true },
        ],
        centers: { d1: 3, d2: 1 },
        activeChildren: { d1: 50, d2: 20 },
      }) as never,
    );

    const result = await service.getDistrictRisk(user({ role: UserRole.ncda_admin }), {});
    eq(result.total, 2);
    eq(result.items.map((i) => i.districtId).sort(), ['d1', 'd2']);
    eq(result.methodologyVersion, 'district-risk-v1');
  });

  await assert('inactive district severity is critical', async () => {
    const service = new DistrictRiskService(
      createPrisma({
        districts: [{ id: 'd1', name: 'Inactive', code: 'I', isActive: false }],
        centers: { d1: 1 },
      }) as never,
    );
    const result = await service.getDistrictRisk(user({ role: UserRole.ncda_admin }), {});
    eq(result.items[0].severity, 'critical');
    eq(result.items[0].primaryIssueCode, 'district_inactive');
  });

  await assert('STED concern band maps to severity concern', async () => {
    const service = new DistrictRiskService(
      createPrisma({
        districts: [{ id: 'd1', name: 'Gasabo', code: 'GAS', isActive: true }],
        activeChildren: { d1: 100 },
        sted: { d1: { assessmentsCompleted: 40, childrenAssessed: 40 } },
      }) as never,
    );
    const result = await service.getDistrictRisk(user({ role: UserRole.ncda_admin }), {});
    eq(result.items[0].stedCoverage, 40);
    eq(result.items[0].severity, 'concern');
    eq(result.items[0].primaryIssueCode, 'sted_coverage_low');
  });

  await assert('no attendance data yields null rate and zero records', async () => {
    const service = new DistrictRiskService(
      createPrisma({
        districts: [{ id: 'd1', name: 'Gasabo', code: 'GAS', isActive: true }],
        activeChildren: { d1: 10 },
      }) as never,
    );
    const result = await service.getDistrictRisk(user({ role: UserRole.ncda_admin }), {});
    eq(result.items[0].attendanceRate, null);
    eq(result.items[0].attendanceRecords, 0);
    eq(result.items[0].signalFlags.includes('no_attendance_data'), true);
  });

  await assert('zero severe nutrition is real zero', async () => {
    const service = new DistrictRiskService(
      createPrisma({
        districts: [{ id: 'd1', name: 'Gasabo', code: 'GAS', isActive: true }],
        nutrition: { d1: { screenings: 5, severe: 0 } },
      }) as never,
    );
    const result = await service.getDistrictRisk(user({ role: UserRole.ncda_admin }), {});
    eq(result.items[0].severeNutritionCount, 0);
    eq(result.items[0].nutritionScreenings, 5);
  });

  await assert('missing nutrition aggregate defaults to zero counts', async () => {
    const service = new DistrictRiskService(
      createPrisma({
        districts: [{ id: 'd1', name: 'Gasabo', code: 'GAS', isActive: true }],
      }) as never,
    );
    const result = await service.getDistrictRisk(user({ role: UserRole.ncda_admin }), {});
    eq(result.items[0].severeNutritionCount, 0);
    eq(result.items[0].nutritionScreenings, 0);
  });

  await assert('pending referrals reflect open pipeline count', async () => {
    const service = new DistrictRiskService(
      createPrisma({
        districts: [{ id: 'd1', name: 'Gasabo', code: 'GAS', isActive: true }],
        pendingReferrals: { d1: 4 },
      }) as never,
    );
    const result = await service.getDistrictRisk(user({ role: UserRole.ncda_admin }), {});
    eq(result.items[0].pendingReferralCount, 4);
    eq(result.items[0].signalFlags.includes('referrals_pending_present'), true);
  });

  await assert('district focal receives only their district', async () => {
    const service = new DistrictRiskService(
      createPrisma({
        districts: [{ id: 'd-own', name: 'Mine', code: 'M', isActive: true }],
      }) as never,
    );
    const result = await service.getDistrictRisk(
      user({ role: UserRole.district_focal_person, districtId: 'd-own' }),
      {},
    );
    eq(result.total, 1);
    eq(result.items[0].districtId, 'd-own');
  });

  await assert('caregiver is forbidden', async () => {
    const service = new DistrictRiskService(createPrisma({ districts: [] }) as never);
    let threw = false;
    try {
      await service.getDistrictRisk(user({ role: UserRole.caregiver, centerId: 'c1' }), {});
    } catch (e) {
      threw = e instanceof ForbiddenException;
    }
    eq(threw, true);
  });

  await assert('date filtering is forwarded to attendance and nutrition SQL', async () => {
    const prisma = createPrisma({
      districts: [{ id: 'd1', name: 'Gasabo', code: 'GAS', isActive: true }],
      attendance: { d1: { present: 8, absent: 2 } },
    });
    const service = new DistrictRiskService(prisma as never);
    const from = new Date('2026-08-01T00:00:00.000Z');
    const to = new Date('2026-08-31T00:00:00.000Z');
    const result = await service.getDistrictRisk(user({ role: UserRole.ncda_admin }), { from, to });
    eq(result.from, from.toISOString());
    eq(result.to, to.toISOString());
    eq(result.items[0].attendanceRate, 80);
    eq(result.items[0].attendanceRecords, 10);
  });

  await assert('uses fixed query count (no N+1 per district)', async () => {
    const prisma = createPrisma({
      districts: [
        { id: 'd1', name: 'A', code: 'A', isActive: true },
        { id: 'd2', name: 'B', code: 'B', isActive: true },
        { id: 'd3', name: 'C', code: 'C', isActive: true },
      ],
    });
    const service = new DistrictRiskService(prisma as never);
    await service.getDistrictRisk(user({ role: UserRole.ncda_admin }), {});
    eq(prisma.stats.districtFindMany, 1);
    eq(prisma.stats.queryRaw, 7);
  });

  await assert('riskScore is null in Phase 1', async () => {
    const service = new DistrictRiskService(
      createPrisma({
        districts: [{ id: 'd1', name: 'Gasabo', code: 'GAS', isActive: true }],
        sted: { d1: { assessmentsCompleted: 5, childrenAssessed: 5 } },
        activeChildren: { d1: 100 },
      }) as never,
    );
    const result = await service.getDistrictRisk(user({ role: UserRole.ncda_admin }), {});
    eq(result.items[0].riskScore, null);
  });

  console.log('\nAll district-risk tests passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

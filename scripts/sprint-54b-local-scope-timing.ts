/**
 * Sprint 5.4B — local scope-sensitive timing for monitoring/attendance.
 * Simulates NCDA-scale center cardinality against the MonitoringService
 * aggregation path (does not require 39k DB rows).
 *
 * Run: npx ts-node scripts/sprint-54b-local-scope-timing.ts
 */
import { UserRole } from '@prisma/client';
import { AuthUser } from '../src/modules/auth/interfaces/jwt-payload.interface';
import { MonitoringService } from '../src/modules/monitoring/monitoring.service';

function user(role: UserRole, districtId: string | null = null): AuthUser {
  return {
    id: 'timing-user',
    username: 'timing',
    email: null,
    fullName: 'Timing',
    role,
    centerId: null,
    districtId,
    status: 'active',
  };
}

function makePrisma(centerCount: number) {
  const centers = Array.from({ length: centerCount }, (_, i) => ({
    id: `c${i}`,
    name: `Center ${i}`,
  }));
  let attendanceCountCalls = 0;
  let attendanceGroupByCalls = 0;
  let childCountCalls = 0;
  let childGroupByCalls = 0;

  return {
    stats: () => ({
      attendanceCountCalls,
      attendanceGroupByCalls,
      childCountCalls,
      childGroupByCalls,
      centerCount,
    }),
    ecdCenter: {
      findMany: async () => centers,
      findFirst: async () =>
        centers[0]
          ? { id: centers[0].id, districtId: 'd1', villageId: 'v1' }
          : null,
      count: async () => centerCount,
    },
    child: {
      count: async () => {
        childCountCalls += 1;
        return 0;
      },
      groupBy: async () => {
        childGroupByCalls += 1;
        return [];
      },
      findMany: async () => [],
    },
    attendanceRecord: {
      count: async () => {
        attendanceCountCalls += 1;
        return 0;
      },
      groupBy: async () => {
        attendanceGroupByCalls += 1;
        return [];
      },
    },
    childNutritionScreening: {
      groupBy: async () => [],
      count: async () => 0,
    },
    centerFeedingDay: {
      count: async () => 0,
      groupBy: async () => [],
    },
    stedAssessment: {
      findMany: async () => [],
      count: async () => 0,
    },
    referral: {
      count: async () => 0,
      groupBy: async () => [],
      findMany: async () => [],
    },
    administrativeUnit: {
      findUnique: async () => null,
      findMany: async () => [],
    },
    $queryRaw: async () => [],
  };
}

async function timeAttendance(label: string, centerCount: number, actor: AuthUser) {
  const prisma = makePrisma(centerCount);
  const service = new MonitoringService(prisma as never);
  const t0 = Date.now();
  const result = await service.attendance(actor, {
    from: new Date('2026-08-01'),
    to: new Date('2026-08-10'),
    page: 1,
    pageSize: 20,
  });
  const ms = Date.now() - t0;
  const stats = prisma.stats();
  console.log(
    JSON.stringify({
      label,
      centers: centerCount,
      ms,
      total: result.total,
      items: result.items.length,
      attendanceCountCalls: stats.attendanceCountCalls,
      attendanceGroupByCalls: stats.attendanceGroupByCalls,
      childCountCalls: stats.childCountCalls,
      childGroupByCalls: stats.childGroupByCalls,
      // Pre-fix fan-out would be ~3 * centerCount attendance counts.
      legacyFanOutEstimate: 3 * centerCount,
    }),
  );
}

async function main() {
  await timeAttendance('small-district', 20, user(UserRole.district_focal_person, 'd1'));
  await timeAttendance('medium-district', 500, user(UserRole.district_focal_person, 'd1'));
  await timeAttendance('ncda-national-scale', 39445, user(UserRole.ncda_admin));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

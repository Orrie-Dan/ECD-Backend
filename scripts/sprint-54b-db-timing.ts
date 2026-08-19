/**
 * Sprint 5.4B — real local DB timing for monitoring under NCDA scope.
 * Run: npx ts-node scripts/sprint-54b-db-timing.ts
 */
import { UserRole } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuthUser } from '../src/modules/auth/interfaces/jwt-payload.interface';
import { MonitoringService } from '../src/modules/monitoring/monitoring.service';
import { AlertsService } from '../src/modules/alerts/alerts.service';
import { ReportsService } from '../src/modules/reports/reports.service';
import { NutritionService } from '../src/modules/nutrition/nutrition.service';
import { ReferralsService } from '../src/modules/referrals/referrals.service';
import { SyncAccessService } from '../src/modules/sync/sync-access.service';

async function timed<T>(label: string, fn: () => Promise<T>) {
  const t0 = Date.now();
  try {
    const result = await fn();
    const ms = Date.now() - t0;
    const r = result as { total?: number; items?: unknown[] } | null;
    console.log(
      JSON.stringify({
        label,
        ok: true,
        ms,
        total: r?.total,
        items: Array.isArray(r?.items) ? r.items.length : undefined,
      }),
    );
    return result;
  } catch (e) {
    const ms = Date.now() - t0;
    console.log(
      JSON.stringify({
        label,
        ok: false,
        ms,
        error: e instanceof Error ? e.message : String(e),
      }),
    );
    return null;
  }
}

async function main() {
  const prisma = new PrismaService();
  await prisma.$connect();

  const centers = await prisma.ecdCenter.count({ where: { deletedAt: null } });
  const children = await prisma.child.count({ where: { deletedAt: null } });
  const attendance = await prisma.attendanceRecord.count({
    where: { deletedAt: null },
  });
  console.log(
    JSON.stringify({ phase: 'inventory', centers, children, attendance }),
  );

  const ncdaUser = await prisma.userAccount.findFirst({
    where: { role: UserRole.ncda_admin, status: 'active' },
  });
  const districtUser = await prisma.userAccount.findFirst({
    where: { role: UserRole.district_focal_person, status: 'active' },
  });

  console.log(
    JSON.stringify({
      phase: 'accounts',
      ncda: ncdaUser
        ? { username: ncdaUser.username, districtId: ncdaUser.districtId }
        : null,
      district: districtUser
        ? {
            username: districtUser.username,
            districtId: districtUser.districtId,
          }
        : null,
    }),
  );

  if (!ncdaUser) {
    console.log(JSON.stringify({ phase: 'abort', reason: 'no ncda_admin' }));
    await prisma.$disconnect();
    return;
  }

  const actor: AuthUser = {
    id: ncdaUser.id,
    username: ncdaUser.username,
    email: ncdaUser.email,
    fullName: ncdaUser.fullName,
    role: ncdaUser.role,
    centerId: ncdaUser.centerId,
    districtId: ncdaUser.districtId,
    status: ncdaUser.status,
  };

  const monitoring = new MonitoringService(prisma);
  const alerts = new AlertsService(prisma);
  const reports = new ReportsService(prisma);
  const syncAccess = new SyncAccessService(prisma);
  const nutrition = new NutritionService(prisma, syncAccess as never, null as never, null as never);
  const referrals = new ReferralsService(prisma, syncAccess as never, null as never, null as never);

  const query = {
    from: new Date('2026-07-01'),
    to: new Date('2026-08-11'),
    page: 1,
    pageSize: 20,
  };

  await timed('monitoring.attendance ncda', () =>
    monitoring.attendance(actor, query),
  );
  await timed('monitoring.nutrition ncda', () =>
    monitoring.nutrition(actor, query),
  );
  await timed('monitoring.feeding ncda', () =>
    monitoring.feeding(actor, query),
  );
  await timed('monitoring.referrals ncda', () =>
    monitoring.referrals(actor, query),
  );
  await timed('monitoring.sted ncda', () => monitoring.sted(actor, query));
  await timed('alerts.followUp ncda', () =>
    alerts.getFollowUpAlerts(actor, { limit: 50 }),
  );
  await timed('reports.district ncda', () => reports.district(actor, query));
  await timed('reports.enrollment ncda', () =>
    reports.enrollment(actor, query),
  );
  await timed('reports.centers ncda', () => reports.centers(actor, query));
  await timed('nutrition.listScreenings ncda', () =>
    nutrition.listScreenings(actor, { page: 1, pageSize: 50 }),
  );
  await timed('referrals.findAll ncda', () =>
    referrals.findAll(actor, { page: 1, pageSize: 50 }),
  );

  if (districtUser?.districtId) {
    const dActor: AuthUser = {
      id: districtUser.id,
      username: districtUser.username,
      email: districtUser.email,
      fullName: districtUser.fullName,
      role: districtUser.role,
      centerId: districtUser.centerId,
      districtId: districtUser.districtId,
      status: districtUser.status,
    };
    await timed('monitoring.attendance district', () =>
      monitoring.attendance(dActor, query),
    );
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  process.exit(1);
});

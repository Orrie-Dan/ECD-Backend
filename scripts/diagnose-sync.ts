import { PrismaClient } from '@prisma/client';

const childId = process.argv[2] ?? '604e099c-1c79-41b1-a394-4cc2c0fe917b';
const deviceId = process.argv[3] ?? 'c143fc0e-8ee8-44e3-b940-82c91c3d3a15';
const centerId = '37e62d08-6d84-4470-8d45-cc2b9c9eb494';
const districtId = '861e2b35-18c3-4836-a4c6-0df0ef47bb29';

async function main() {
  const p = new PrismaClient();
  try {
    const child = await p.child.findUnique({
      where: { id: childId },
      select: { id: true, firstName: true, centerId: true, homeVillageId: true },
    });
    const childrenAtCenter = await p.child.count({ where: { centerId } });
    const syncSessions = await p.syncSession.findMany({
      where: { deviceId },
      orderBy: { startedAt: 'desc' },
      take: 3,
      select: {
        id: true,
        status: true,
        startedAt: true,
        totalOperations: true,
        successfulOperations: true,
        failedOperations: true,
      },
    });
    const syncOps = await p.syncOperation.findMany({
      where: { OR: [{ entityId: childId }, { deviceId }] },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        status: true,
        entityType: true,
        entityId: true,
        operation: true,
        conflictReason: true,
        createdAt: true,
      },
    });
    const sectors = await p.administrativeUnit.findMany({
      where: { districtId, level: 'sector' },
      select: { id: true, name: true },
    });
    const cells = await p.administrativeUnit.findMany({
      where: { level: 'cell', parentId: { in: sectors.map((s) => s.id) } },
      select: { id: true, name: true },
    });
    const villages = await p.administrativeUnit.findMany({
      where: { level: 'village', parentId: { in: cells.map((c) => c.id) } },
      select: { id: true, name: true, districtId: true },
    });
    const pushCount = await p.syncSession.count({
      where: { deviceId, totalOperations: { gt: 0 } },
    });
    const device = await p.device.findUnique({
      where: { id: deviceId },
      include: { user: { select: { username: true, role: true } } },
    });
    const totalSessions = await p.syncSession.count();
    const totalOps = await p.syncOperation.count();
    const failedOps = await p.syncOperation.findMany({
      where: { status: 'failed' },
      take: 5,
      orderBy: { createdAt: 'desc' },
      select: {
        entityType: true,
        entityId: true,
        conflictReason: true,
        status: true,
        deviceId: true,
      },
    });

    console.log(
      JSON.stringify(
        {
          device: device
            ? {
                id: device.id,
                user: device.user,
                lastSyncAt: device.lastSyncAt,
              }
            : null,
          child,
          childrenAtCenter,
          pushSessionsWithOps: pushCount,
          totalSessionsInDb: totalSessions,
          totalOpsInDb: totalOps,
          recentFailedOps: failedOps,
          recentSyncSessions: syncSessions,
          recentSyncOps: syncOps,
          rutsiroHierarchy: { sectors, cells, villages },
        },
        null,
        2,
      ),
    );
  } finally {
    await p.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

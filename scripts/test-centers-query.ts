import { ChildStatus } from '../src/common/domain';
import { PrismaClient } from '@prisma/client';
async function main() {
  const p = new PrismaClient();
  try {
    const [rows, total] = await p.$transaction([
      p.ecdCenter.findMany({
        where: { deletedAt: null, name: { contains: 'Kigali', mode: 'insensitive' } },
        include: {
          district: { select: { name: true } },
          village: { select: { name: true } },
          _count: {
            select: {
              children: { where: { deletedAt: null, status: ChildStatus.active } },
            },
          },
        },
        take: 5,
      }),
      p.ecdCenter.count({
        where: { deletedAt: null, name: { contains: 'Kigali', mode: 'insensitive' } },
      }),
    ]);
    console.log('OK centers:', total, 'sample:', rows[0]?.name ?? '(none)');
  } catch (e) {
    console.error('FAIL:', (e as Error).message);
    process.exit(1);
  } finally {
    await p.$disconnect();
  }
}

main();

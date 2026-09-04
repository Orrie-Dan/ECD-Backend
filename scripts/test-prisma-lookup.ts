import { PrismaClient } from '@prisma/client';

async function main() {
  const p = new PrismaClient();
  try {
    const rows = await p.lookupChildStatus.findMany();
    console.log('lookup_child_status count:', rows.length);
  } catch (e) {
    console.error('Error:', (e as Error).message);
  } finally {
    await p.$disconnect();
  }
}

main();

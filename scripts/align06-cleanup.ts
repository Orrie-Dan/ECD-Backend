import { PrismaClient } from '@prisma/client';

const p = new PrismaClient();

async function main() {
  const r = await p.complianceAssessment.updateMany({
    where: {
      centerId: '9b754e5c-9058-4aa1-8946-94b9ec3903ee',
      standardsVersion: { contains: '2024.3-official' },
      deletedAt: null,
    },
    data: { deletedAt: new Date() },
  });
  console.log('cleaned', r.count);
  await p.ecdCenter.update({
    where: { id: '9b754e5c-9058-4aa1-8946-94b9ec3903ee' },
    data: { facilityType: 'ecd_3_5' },
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => p.$disconnect());

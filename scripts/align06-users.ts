import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const users = await prisma.userAccount.findMany({
    select: {
      id: true,
      username: true,
      role: true,
      centerId: true,
      districtId: true,
      status: true,
      fullName: true,
      center: { select: { name: true, facilityType: true, code: true } },
    },
    orderBy: [{ role: 'asc' }, { username: 'asc' }],
  });
  for (const u of users) {
    console.log(
      JSON.stringify({
        username: u.username,
        role: u.role,
        status: u.status,
        fullName: u.fullName,
        center: u.center
          ? { name: u.center.name, code: u.center.code, facilityType: u.center.facilityType }
          : null,
        centerId: u.centerId,
        districtId: u.districtId,
      }),
    );
  }

  // Directors on home_based / community_based if any
  const classifiedDirectors = await prisma.userAccount.findMany({
    where: {
      role: 'ecd_director',
      center: {
        facilityType: { in: ['home_based', 'community_based', 'daycare', 'ecd_3_5'] },
      },
    },
    select: {
      username: true,
      center: { select: { id: true, name: true, code: true, facilityType: true } },
    },
  });
  console.log('classifiedDirectors', JSON.stringify(classifiedDirectors));

  // Find centers with directors for home_based / community
  const withDir = await prisma.$queryRaw<
    Array<{ facility_type: string; n: number }>
  >`
    SELECT c.facility_type, COUNT(*)::int AS n
    FROM sde.ecd_center c
    INNER JOIN sde.user_account u ON u.center_id = c.id AND u.role = 'ecd_director'
    WHERE c.deleted_at IS NULL AND c.facility_type IS NOT NULL
    GROUP BY 1
    ORDER BY 1
  `;
  console.log('centersWithDirectors', JSON.stringify(withDir));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

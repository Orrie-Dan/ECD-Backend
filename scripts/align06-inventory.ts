import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const counts = await prisma.$queryRaw<Array<{ facility_type: string | null; n: number }>>`
    SELECT facility_type, COUNT(*)::int AS n
    FROM sde.ecd_center
    WHERE deleted_at IS NULL
    GROUP BY 1
    ORDER BY 1 NULLS FIRST
  `;
  console.log('facilityTypeCounts', JSON.stringify(counts));

  for (const ft of ['daycare', 'home_based', 'community_based', 'ecd_3_5'] as const) {
    const centers = await prisma.ecdCenter.findMany({
      where: { facilityType: ft, deletedAt: null },
      select: { id: true, name: true, facilityType: true, code: true },
      take: 8,
      orderBy: { name: 'asc' },
    });
    console.log(ft, JSON.stringify(centers));
  }

  const nullSample = await prisma.ecdCenter.findMany({
    where: { facilityType: null, deletedAt: null },
    select: { id: true, name: true, facilityType: true, code: true },
    take: 5,
    orderBy: { name: 'asc' },
  });
  console.log('nullSample', JSON.stringify(nullSample));

  const testNamed = await prisma.ecdCenter.findMany({
    where: {
      deletedAt: null,
      OR: [
        { name: { contains: 'TEST', mode: 'insensitive' } },
        { name: { contains: 'ALIGN', mode: 'insensitive' } },
        { code: { contains: 'TEST', mode: 'insensitive' } },
      ],
    },
    select: { id: true, name: true, facilityType: true, code: true },
    take: 20,
  });
  console.log('testNamed', JSON.stringify(testNamed));

  const assessments = await prisma.$queryRaw<
    Array<{ standards_version: string | null; assessment_type: string; status: string; n: number }>
  >`
    SELECT standards_version, assessment_type::text, status::text, COUNT(*)::int AS n
    FROM sde.compliance_assessment
    WHERE deleted_at IS NULL
    GROUP BY 1,2,3
    ORDER BY 1,2,3
  `;
  console.log('assessmentGroups', JSON.stringify(assessments));

  const users = await prisma.$queryRaw<Array<{ role: string; n: number }>>`
    SELECT role::text AS role, COUNT(*)::int AS n
    FROM sde.user_account
    GROUP BY 1
    ORDER BY 1
  `;
  console.log('userRoles', JSON.stringify(users));

  const directors = await prisma.userAccount.findMany({
    where: { role: 'ecd_director', centerId: { not: null } },
    select: {
      id: true,
      email: true,
      fullName: true,
      role: true,
      centerId: true,
      center: { select: { id: true, name: true, facilityType: true, code: true } },
    },
    take: 80,
  });
  const byFt: Record<string, typeof directors> = {};
  for (const d of directors) {
    const ft = d.center?.facilityType ?? 'null';
    (byFt[ft] ??= []).push(d);
  }
  for (const [ft, list] of Object.entries(byFt)) {
    console.log(
      'directors',
      ft,
      list.length,
      JSON.stringify(
        list.slice(0, 3).map((row) => ({
          email: row.email,
          centerId: row.centerId,
          centerName: row.center?.name,
          facilityType: row.center?.facilityType,
        })),
      ),
    );
  }

  for (const ver of ['2024.1', '2024.2-weighted', '2024.3-official']) {
    const sample = await prisma.complianceAssessment.findMany({
      where: {
        deletedAt: null,
        OR: [{ standardsVersion: { startsWith: ver } }, { standardsVersion: ver }],
      },
      select: {
        id: true,
        status: true,
        standardsVersion: true,
        assessmentType: true,
        centerId: true,
        overallPercent: true,
        overallRank: true,
      },
      take: 5,
      orderBy: { createdAt: 'desc' },
    });
    console.log('sample', ver, JSON.stringify(sample));
  }

  const drafts = await prisma.complianceAssessment.findMany({
    where: {
      status: 'draft',
      assessmentType: 'self_assessment',
      deletedAt: null,
    },
    select: {
      id: true,
      standardsVersion: true,
      centerId: true,
      createdAt: true,
    },
    take: 10,
    orderBy: { createdAt: 'desc' },
  });
  console.log('selfEvalDrafts', JSON.stringify(drafts));
}

main()
  .catch((e) => {
    console.error('ERR', e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

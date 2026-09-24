const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

(async () => {
  const total = await p.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS c FROM sde.ecd_center WHERE deleted_at IS NULL`,
  );
  const classified = await p.$queryRawUnsafe(
    `SELECT facility_type, COUNT(*)::int AS n
     FROM sde.ecd_center WHERE deleted_at IS NULL AND facility_type IS NOT NULL
     GROUP BY facility_type ORDER BY n DESC`,
  );
  const unclassified = await p.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS c FROM sde.ecd_center WHERE deleted_at IS NULL AND facility_type IS NULL`,
  );
  console.log(JSON.stringify({ total, classified, unclassified }, null, 2));
  await p.$disconnect();
})().catch(async (e) => {
  console.error(e);
  await p.$disconnect();
  process.exit(1);
});

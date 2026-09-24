const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

(async () => {
  const total = await p.$queryRawUnsafe(
    'SELECT COUNT(*)::int AS c FROM sde.ecd_center WHERE deleted_at IS NULL',
  );
  const mapping = await p.$queryRawUnsafe(`
    SELECT COALESCE(settings_types, '(null)') AS settings_types, COUNT(*)::int AS n
    FROM sde.ecd_mapping_form
    GROUP BY settings_types
    ORDER BY n DESC
  `);
  const joined = await p.$queryRawUnsafe(`
    SELECT COALESCE(m.settings_types, '(null)') AS settings_types, COUNT(DISTINCT c.id)::int AS n
    FROM sde.ecd_center c
    LEFT JOIN LATERAL (
      SELECT settings_types
      FROM sde.ecd_mapping_form m2
      WHERE m2.center_id = c.id OR m2.ecd_code = c.code
      ORDER BY m2.last_edited_date DESC NULLS LAST, m2.objectid DESC
      LIMIT 1
    ) m ON true
    WHERE c.deleted_at IS NULL
    GROUP BY m.settings_types
    ORDER BY n DESC
  `);
  const withMapping = await p.$queryRawUnsafe(`
    SELECT COUNT(DISTINCT c.id)::int AS c
    FROM sde.ecd_center c
    JOIN sde.ecd_mapping_form m ON (m.center_id = c.id OR m.ecd_code = c.code)
    WHERE c.deleted_at IS NULL
      AND m.settings_types IS NOT NULL
      AND TRIM(m.settings_types) <> ''
  `);
  const drafts43 = await p.$queryRawUnsafe(`
    SELECT standards_version, status, COUNT(*)::int AS n
    FROM sde.compliance_assessment
    WHERE standards_version LIKE '%2024.3%'
    GROUP BY standards_version, status
    ORDER BY n DESC
  `).catch((e) => [{ error: String(e.message || e) }]);

  console.log(JSON.stringify({ total, withMapping, mapping, joined, drafts43 }, null, 2));
  await p.$disconnect();
})().catch(async (e) => {
  console.error(e);
  await p.$disconnect();
  process.exit(1);
});

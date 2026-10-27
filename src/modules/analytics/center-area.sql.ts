import { AdministrativeLevel } from '../../common/domain';
import { Prisma } from '@prisma/client';

/** Area grains a center can be attributed to. */
export type CenterAreaLevel = 'district' | 'sector' | 'center';

/** Village → cell → sector is two hops; the cap only guards against a cyclic hierarchy. */
const MAX_HIERARCHY_HOPS = 6;

/** `up(village_id, unit_id, parent_id, level, hops)`: each center village and its ancestors up to the sector. */
function villageAncestorsCte(districtSql: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`
    WITH RECURSIVE up AS (
      SELECT v.id AS village_id, v.id AS unit_id, v.parent_id, v.level, 0 AS hops
      FROM administrative_unit v
      WHERE v.id IN (
        SELECT c.village_id FROM ecd_center c WHERE c.deleted_at IS NULL AND ${districtSql}
      )
      UNION ALL
      SELECT up.village_id, p.id, p.parent_id, p.level, up.hops + 1
      FROM up
      INNER JOIN administrative_unit p ON p.id = up.parent_id
      WHERE up.level <> ${AdministrativeLevel.sector} AND up.hops < ${MAX_HIERARCHY_HOPS}
    )`;
}

/**
 * `center_area(center_id, area_id)` for non-deleted centers in scope. Sector level
 * walks each center village up to its sector-level ancestor; center level maps a
 * center to itself so the same aggregate queries work at every grain. `sectorId`
 * keeps only centers whose village lies in that sector.
 */
export function centerAreaCte(
  level: CenterAreaLevel,
  districtId: string | null,
  sectorId: string | null = null,
): Prisma.Sql {
  const districtSql = districtId ? Prisma.sql`c.district_id = ${districtId}` : Prisma.sql`TRUE`;
  const areaColumn =
    level === 'district'
      ? Prisma.sql`c.district_id`
      : level === 'center'
        ? Prisma.sql`c.id`
        : Prisma.sql`up.unit_id`;
  if (level !== 'sector' && !sectorId) {
    return Prisma.sql`
      WITH center_area AS (
        SELECT c.id AS center_id, ${areaColumn} AS area_id
        FROM ecd_center c
        WHERE c.deleted_at IS NULL AND ${districtSql}
      )`;
  }
  const sectorSql = sectorId ? Prisma.sql`up.unit_id = ${sectorId}` : Prisma.sql`TRUE`;
  return Prisma.sql`
    ${villageAncestorsCte(districtSql)},
    center_area AS (
      SELECT c.id AS center_id, ${areaColumn} AS area_id
      FROM ecd_center c
      INNER JOIN up ON up.village_id = c.village_id AND up.level = ${AdministrativeLevel.sector}
      WHERE c.deleted_at IS NULL AND ${districtSql} AND ${sectorSql}
    )`;
}

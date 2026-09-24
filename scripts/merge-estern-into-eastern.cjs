/**
 * FIX-05 data remediation: collapse typo province "Estern Province"
 * into canonical "Eastern Province".
 *
 * Safe for local/dev DB. Does NOT touch ArcGIS hosted layers.
 *
 * Usage: node scripts/merge-estern-into-eastern.cjs
 */
const { PrismaClient } = require('@prisma/client')

const EASTERN_ID = '68b65941-70d9-44a5-8368-fe706705d0dd'
const ESTERN_ID = 'd470a524-85da-4c56-aa02-3e5ab9cc537e'

/** Estern center → Eastern district + village (same place names). */
const CENTER_REMAP = [
  {
    centerId: '587565a0-d4b2-4f70-8327-09b4944309c6', // Ganza ECD CENTER
    toDistrictId: 'b60678eb-7734-48da-a528-39febb0d3df8', // Eastern Nyagatare
    toVillageId: '7d9dd13a-2961-4bc9-8605-f033fb88de47', // Kamagiri
  },
  {
    centerId: '95a37691-24c8-48e4-bb7f-3c9496d63840', // Turamahoro ECD
    toDistrictId: '08a360d5-c810-48f4-bfec-093f595a565a', // Eastern Kirehe
    toVillageId: 'a284ccd3-b93c-4121-a9e3-8f787690c1a2', // Maranyundo
  },
]

const ESTERN_DISTRICT_IDS = [
  'f2f359f1-1d36-4deb-b335-cd5f8f40e4a3', // Estern Nyagatare
  '06261dc9-3976-49b0-8551-44b8c3eb052e', // Estern Kirehe
]

const p = new PrismaClient()

async function collectDescendantIds(rootIds) {
  const all = [...rootIds]
  let frontier = [...rootIds]
  while (frontier.length) {
    const kids = await p.administrativeUnit.findMany({
      where: { parentId: { in: frontier } },
      select: { id: true },
    })
    const ids = kids.map((k) => k.id)
    all.push(...ids)
    frontier = ids
  }
  return all
}

async function main() {
  const eastern = await p.administrativeUnit.findUnique({ where: { id: EASTERN_ID } })
  const estern = await p.administrativeUnit.findUnique({ where: { id: ESTERN_ID } })
  if (!eastern || eastern.name !== 'Eastern Province') {
    throw new Error(`Canonical Eastern Province missing/unexpected: ${JSON.stringify(eastern)}`)
  }
  if (!estern) {
    console.log('Estern Province already absent — nothing to do.')
    return
  }
  if (estern.name !== 'Estern Province') {
    throw new Error(`Unexpected Estern row: ${JSON.stringify(estern)}`)
  }

  console.log('Remapping centers off Estern districts…')
  for (const row of CENTER_REMAP) {
    const updated = await p.ecdCenter.update({
      where: { id: row.centerId },
      data: { districtId: row.toDistrictId, villageId: row.toVillageId },
      select: { id: true, name: true, districtId: true, villageId: true },
    })
    console.log('  center', updated)
  }

  // Remap any Child.homeVillage still on Estern villages (none expected).
  const esternSectors = await p.administrativeUnit.findMany({
    where: { districtId: { in: ESTERN_DISTRICT_IDS }, level: 'sector' },
    select: { id: true },
  })
  const esternTreeIds = await collectDescendantIds(esternSectors.map((s) => s.id))
  esternTreeIds.push(...esternSectors.map((s) => s.id))

  const homeVillageChildren = await p.child.count({
    where: { homeVillageId: { in: esternTreeIds } },
  }).catch(() => 0)
  if (homeVillageChildren > 0) {
    throw new Error(
      `Refusing to delete: ${homeVillageChildren} children still reference Estern villages`,
    )
  }

  const sectorUsers = await p.userAccount.count({
    where: { sectorId: { in: esternTreeIds } },
  }).catch(() => 0)
  if (sectorUsers > 0) {
    throw new Error(`Refusing to delete: ${sectorUsers} users still reference Estern sectors`)
  }

  // Delete admin units deepest-first (village → cell → sector).
  const byLevel = await p.administrativeUnit.findMany({
    where: { id: { in: esternTreeIds } },
    select: { id: true, level: true, name: true },
  })
  const order = { village: 0, cell: 1, sector: 2 }
  byLevel.sort((a, b) => (order[a.level] ?? 9) - (order[b.level] ?? 9))
  console.log('Deleting Estern admin units…', byLevel.length)
  for (const row of byLevel) {
    await p.administrativeUnit.delete({ where: { id: row.id } })
    console.log('  deleted', row.level, row.name)
  }

  console.log('Deleting Estern districts…')
  for (const id of ESTERN_DISTRICT_IDS) {
    await p.district.delete({ where: { id } })
    console.log('  deleted district', id)
  }

  console.log('Deleting Estern Province…')
  await p.administrativeUnit.delete({ where: { id: ESTERN_ID } })

  const leftover = await p.administrativeUnit.findMany({
    where: {
      level: 'province',
      name: { contains: 'stern', mode: 'insensitive' },
    },
    select: { id: true, name: true },
  })
  console.log('Remaining *stern* provinces:', leftover)
  console.log('DONE — UI should show only Eastern Province.')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await p.$disconnect()
  })

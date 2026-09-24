import { AdministrativeLevel, UserRole } from '../domain';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import {
  assertCenterAccess,
  assertDistrictAccess,
  isCenterStaffRole,
  isDistrictPortalRole,
  type ScopeUser,
} from '../auth/scope.util';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../../modules/auth/interfaces/jwt-payload.interface';

/**
 * Resolved geographic query scope.
 *
 * Hierarchy (most specific wins for filtering; parents are validated constraints):
 * National → Province → District → Sector → Cell → Village → Center
 *
 * `centerIds: 'all'` means no center-id IN list — use relational province/district/village
 * filters via {@link ecdCenterWhere} / {@link childCenterWhere} instead of huge IN clauses.
 */
export type DistrictQueryScope = {
  centerIds: string[] | 'all';
  provinceId: string | null;
  districtId: string | null;
  sectorId: string | null;
  cellId: string | null;
  villageId: string | null;
  singleCenterId: string | null;
};

/** Alias — preferred name for FIX-02+ callers. */
export type GeographicQueryScope = DistrictQueryScope;

export type ScopeQuery = {
  provinceId?: string;
  districtId?: string;
  sectorId?: string;
  cellId?: string;
  villageId?: string;
  centerId?: string;
};

/** Shared date-range helper for monitoring/reports (inclusive UTC days). */
export function resolveInclusiveDateRange(
  from?: Date,
  to?: Date,
  defaultDays = 29,
): { from: Date; to: Date } {
  const end = to ? startOfUtcDay(to) : startOfUtcDay(new Date());
  const start = from
    ? startOfUtcDay(from)
    : new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate() - defaultDays));
  if (start.getTime() > end.getTime()) {
    throw new BadRequestException('`from` must be on or before `to`');
  }
  return { from: start, to: end };
}

export function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function paginateParams(page?: number, pageSize?: number, max = 100) {
  const p = Math.max(1, page ?? 1);
  const ps = Math.min(max, Math.max(1, pageSize ?? 20));
  return { page: p, pageSize: ps, skip: (p - 1) * ps };
}

function scopeResult(
  partial: Partial<DistrictQueryScope> & Pick<DistrictQueryScope, 'centerIds'>,
): DistrictQueryScope {
  return {
    centerIds: partial.centerIds,
    provinceId: partial.provinceId ?? null,
    districtId: partial.districtId ?? null,
    sectorId: partial.sectorId ?? null,
    cellId: partial.cellId ?? null,
    villageId: partial.villageId ?? null,
    singleCenterId: partial.singleCenterId ?? null,
  };
}

/**
 * Pin authenticated Sector users to their assignment.
 * Query params cannot broaden scope; foreign sector/district → Forbidden.
 */
export function applyAuthenticatedGeographicQuery(
  user: Pick<AuthUser, 'role' | 'districtId' | 'sectorId'>,
  query: ScopeQuery,
): ScopeQuery {
  if (user.role !== UserRole.sector_focal_person) {
    return query;
  }
  if (!user.districtId || !user.sectorId) {
    throw new ForbiddenException('Sector scope is required');
  }
  if (query.districtId && query.districtId !== user.districtId) {
    throw new ForbiddenException('Cannot query outside assigned district');
  }
  if (query.sectorId && query.sectorId !== user.sectorId) {
    throw new ForbiddenException('Cannot query outside assigned sector');
  }
  return {
    ...query,
    districtId: user.districtId,
    sectorId: user.sectorId,
  };
}

/**
 * Resolve center IDs / relational geography visible to the actor.
 *
 * Inconsistent parent/child combinations → 400 Bad Request (never silent broaden).
 * Authorization (JWT district/sector) still wins over query params.
 */
export async function resolveDistrictQueryScope(
  prisma: PrismaService,
  user: AuthUser,
  query: ScopeQuery,
): Promise<DistrictQueryScope> {
  const effectiveQuery = applyAuthenticatedGeographicQuery(user, query);

  if (isCenterStaffRole(user.role)) {
    if (!user.centerId) {
      throw new ForbiddenException('Center scope is required for this role');
    }
    if (effectiveQuery.centerId && effectiveQuery.centerId !== user.centerId) {
      throw new ForbiddenException('Cannot query another center');
    }
    if (
      effectiveQuery.districtId ||
      effectiveQuery.sectorId ||
      effectiveQuery.cellId ||
      effectiveQuery.villageId ||
      effectiveQuery.provinceId
    ) {
      throw new ForbiddenException(
        'Center-scoped roles cannot filter by province, district, sector, cell, or village',
      );
    }
    return scopeResult({
      centerIds: [user.centerId],
      districtId: user.districtId,
      singleCenterId: user.centerId,
    });
  }

  let districtId: string | null = null;
  let provinceId: string | null = effectiveQuery.provinceId ?? null;

  if (user.role === UserRole.district_focal_person) {
    if (!user.districtId) {
      throw new ForbiddenException('District scope is required');
    }
    if (effectiveQuery.districtId && effectiveQuery.districtId !== user.districtId) {
      assertDistrictAccess(user, effectiveQuery.districtId);
    }
    districtId = user.districtId;
  } else if (user.role === UserRole.sector_focal_person) {
    if (!user.districtId || !user.sectorId) {
      throw new ForbiddenException('Sector scope is required');
    }
    districtId = user.districtId;
  } else if (effectiveQuery.districtId) {
    assertDistrictAccess(user, effectiveQuery.districtId);
    districtId = effectiveQuery.districtId;
  }

  if (provinceId && districtId) {
    await assertDistrictBelongsToProvince(prisma, districtId, provinceId);
  }

  if (provinceId && !districtId && isDistrictPortalRole(user.role)) {
    // District/sector officers cannot broaden to a whole province.
    if (!user.districtId) {
      throw new ForbiddenException('District scope is required');
    }
    const own = await prisma.district.findFirst({
      where: { id: user.districtId },
      select: { provinceId: true },
    });
    if (!own || own.provinceId !== provinceId) {
      throw new ForbiddenException('Cannot query another province');
    }
    districtId = user.districtId;
  }

  const sectorId = effectiveQuery.sectorId ?? null;
  const cellId = effectiveQuery.cellId ?? null;
  const villageId = effectiveQuery.villageId ?? null;

  if (effectiveQuery.centerId) {
    const center = await prisma.ecdCenter.findFirst({
      where: { id: effectiveQuery.centerId, deletedAt: null },
      select: { id: true, districtId: true, villageId: true },
    });
    if (!center) throw new NotFoundException('Center not found');
    await assertCenterAccessible(prisma, user, center);
    if (districtId && center.districtId !== districtId) {
      throw new BadRequestException('centerId does not belong to the given districtId');
    }
    if (provinceId) {
      await assertDistrictBelongsToProvince(prisma, center.districtId, provinceId);
    }
    if (villageId && center.villageId !== villageId) {
      throw new BadRequestException('centerId does not belong to the given villageId');
    }
    if (cellId) {
      await assertUnitIsAncestorOf(prisma, cellId, center.villageId, AdministrativeLevel.cell);
    }
    if (sectorId) {
      await assertUnitIsAncestorOf(prisma, sectorId, center.villageId, AdministrativeLevel.sector);
    }
    return scopeResult({
      centerIds: [center.id],
      provinceId,
      districtId: center.districtId,
      sectorId,
      cellId,
      villageId: villageId ?? center.villageId,
      singleCenterId: center.id,
    });
  }

  // Narrowest admin-unit filter: village → cell → sector
  let villageFilter: string[] | undefined;

  if (villageId) {
    await assertVillageHierarchy(prisma, {
      villageId,
      cellId,
      sectorId,
      districtId,
      provinceId,
    });
    villageFilter = [villageId];
  } else if (cellId) {
    await assertCellHierarchy(prisma, { cellId, sectorId, districtId, provinceId });
    villageFilter = await collectVillageIdsUnder(prisma, cellId);
  } else if (sectorId) {
    await assertSectorBelongsToDistrict(prisma, sectorId, districtId);
    if (provinceId && districtId) {
      await assertDistrictBelongsToProvince(prisma, districtId, provinceId);
    }
    if (provinceId && !districtId) {
      await assertSectorBelongsToProvince(prisma, sectorId, provinceId);
    }
    villageFilter = await collectVillageIdsUnder(prisma, sectorId);
  }

  if (villageFilter) {
    if (villageFilter.length === 0) {
      return scopeResult({
        centerIds: [],
        provinceId,
        districtId,
        sectorId,
        cellId,
        villageId,
        singleCenterId: null,
      });
    }

    const centers = await prisma.ecdCenter.findMany({
      where: {
        deletedAt: null,
        villageId: { in: villageFilter },
        ...(districtId ? { districtId } : {}),
        ...(provinceId && !districtId
          ? { district: { provinceId } }
          : {}),
      },
      select: { id: true },
    });

    return scopeResult({
      centerIds: centers.map((c) => c.id),
      provinceId,
      districtId,
      sectorId,
      cellId,
      villageId,
      singleCenterId: null,
    });
  }

  // District relational (no huge IN) when no sector/cell/village
  if (districtId) {
    return scopeResult({
      centerIds: 'all',
      provinceId,
      districtId,
      sectorId: null,
      cellId: null,
      villageId: null,
      singleCenterId: null,
    });
  }

  // Province relational — do not enumerate all center IDs
  if (provinceId) {
    return scopeResult({
      centerIds: 'all',
      provinceId,
      districtId: null,
      sectorId: null,
      cellId: null,
      villageId: null,
      singleCenterId: null,
    });
  }

  // National
  return scopeResult({
    centerIds: 'all',
    provinceId: null,
    districtId: null,
    sectorId: null,
    cellId: null,
    villageId: null,
    singleCenterId: null,
  });
}

/**
 * Object-level center authorization including Sector village membership.
 * Prefer this over sync `assertCenterAccess` whenever Sector users may call the path.
 */
export async function assertCenterAccessible(
  prisma: PrismaService,
  user: ScopeUser,
  center: { id: string; districtId: string; villageId: string },
): Promise<void> {
  if (user.role === UserRole.ncda_admin) {
    return;
  }

  if (isCenterStaffRole(user.role)) {
    assertCenterAccess(user, center.id, center.districtId);
    return;
  }

  if (user.role === UserRole.district_focal_person) {
    assertCenterAccess(user, center.id, center.districtId);
    return;
  }

  if (user.role === UserRole.sector_focal_person) {
    if (!user.districtId || !user.sectorId) {
      throw new ForbiddenException('Sector scope is required');
    }
    if (user.districtId !== center.districtId) {
      throw new ForbiddenException(`You do not have access to center ${center.id} (${user.role})`);
    }
    const villages = await collectVillageIdsUnder(prisma, user.sectorId);
    if (!villages.includes(center.villageId)) {
      throw new ForbiddenException(`You do not have access to center ${center.id} (${user.role})`);
    }
    return;
  }

  throw new ForbiddenException(`You do not have access to center ${center.id} (${user.role})`);
}

/** Load center then assert geographic access (Sector-safe). */
export async function assertCenterAccessibleById(
  prisma: PrismaService,
  user: ScopeUser,
  centerId: string,
): Promise<{ id: string; districtId: string; villageId: string }> {
  const center = await prisma.ecdCenter.findFirst({
    where: { id: centerId, deletedAt: null },
    select: { id: true, districtId: true, villageId: true },
  });
  if (!center) {
    throw new NotFoundException('Center not found');
  }
  await assertCenterAccessible(prisma, user, center);
  return center;
}

async function assertDistrictBelongsToProvince(
  prisma: PrismaService,
  districtId: string,
  provinceId: string,
): Promise<void> {
  const district = await prisma.district.findUnique({
    where: { id: districtId },
    select: { id: true, provinceId: true },
  });
  if (!district) {
    throw new NotFoundException('District not found');
  }
  if (district.provinceId !== provinceId) {
    throw new BadRequestException('districtId does not belong to the given provinceId');
  }
}

/**
 * When both district and sector are known, reject contradictory geography.
 * Sector units carry `districtId` on AdministrativeUnit.
 */
async function assertSectorBelongsToDistrict(
  prisma: PrismaService,
  sectorId: string,
  districtId: string | null,
): Promise<void> {
  if (!districtId) return;
  const sector = await prisma.administrativeUnit.findUnique({
    where: { id: sectorId },
    select: { id: true, districtId: true, level: true },
  });
  if (!sector) {
    throw new NotFoundException('Sector / administrative unit not found');
  }
  if (sector.level !== AdministrativeLevel.sector) {
    throw new BadRequestException('sectorId must reference a sector-level administrative unit');
  }
  if (sector.districtId && sector.districtId !== districtId) {
    throw new BadRequestException('sectorId does not belong to the given districtId');
  }
}

async function assertSectorBelongsToProvince(
  prisma: PrismaService,
  sectorId: string,
  provinceId: string,
): Promise<void> {
  const sector = await prisma.administrativeUnit.findUnique({
    where: { id: sectorId },
    select: { id: true, districtId: true, level: true },
  });
  if (!sector) {
    throw new NotFoundException('Sector / administrative unit not found');
  }
  if (!sector.districtId) {
    throw new BadRequestException('sectorId is not linked to a district');
  }
  await assertDistrictBelongsToProvince(prisma, sector.districtId, provinceId);
}

async function assertCellHierarchy(
  prisma: PrismaService,
  opts: {
    cellId: string;
    sectorId: string | null;
    districtId: string | null;
    provinceId: string | null;
  },
): Promise<void> {
  const cell = await prisma.administrativeUnit.findUnique({
    where: { id: opts.cellId },
    select: { id: true, level: true, parentId: true, districtId: true },
  });
  if (!cell) {
    throw new NotFoundException('Cell / administrative unit not found');
  }
  if (cell.level !== AdministrativeLevel.cell) {
    throw new BadRequestException('cellId must reference a cell-level administrative unit');
  }
  if (opts.sectorId) {
    await assertUnitIsAncestorOf(prisma, opts.sectorId, opts.cellId, AdministrativeLevel.sector);
  }
  if (opts.districtId && cell.districtId && cell.districtId !== opts.districtId) {
    throw new BadRequestException('cellId does not belong to the given districtId');
  }
  if (opts.districtId && opts.sectorId) {
    await assertSectorBelongsToDistrict(prisma, opts.sectorId, opts.districtId);
  }
  if (opts.provinceId && opts.districtId) {
    await assertDistrictBelongsToProvince(prisma, opts.districtId, opts.provinceId);
  } else if (opts.provinceId && cell.districtId) {
    await assertDistrictBelongsToProvince(prisma, cell.districtId, opts.provinceId);
  }
}

async function assertVillageHierarchy(
  prisma: PrismaService,
  opts: {
    villageId: string;
    cellId: string | null;
    sectorId: string | null;
    districtId: string | null;
    provinceId: string | null;
  },
): Promise<void> {
  const village = await prisma.administrativeUnit.findUnique({
    where: { id: opts.villageId },
    select: { id: true, level: true, parentId: true, districtId: true },
  });
  if (!village) {
    throw new NotFoundException('Village / administrative unit not found');
  }
  if (village.level !== AdministrativeLevel.village) {
    throw new BadRequestException('villageId must reference a village-level administrative unit');
  }
  if (opts.cellId) {
    await assertUnitIsAncestorOf(prisma, opts.cellId, opts.villageId, AdministrativeLevel.cell);
  }
  if (opts.sectorId) {
    await assertUnitIsAncestorOf(
      prisma,
      opts.sectorId,
      opts.villageId,
      AdministrativeLevel.sector,
    );
  }
  if (opts.districtId && village.districtId && village.districtId !== opts.districtId) {
    throw new BadRequestException('villageId does not belong to the given districtId');
  }
  if (opts.provinceId && opts.districtId) {
    await assertDistrictBelongsToProvince(prisma, opts.districtId, opts.provinceId);
  } else if (opts.provinceId && village.districtId) {
    await assertDistrictBelongsToProvince(prisma, village.districtId, opts.provinceId);
  }
}

/**
 * Assert that `ancestorId` (expected level) appears on the parent chain of `descendantId`.
 */
async function assertUnitIsAncestorOf(
  prisma: PrismaService,
  ancestorId: string,
  descendantId: string,
  expectedAncestorLevel: string,
): Promise<void> {
  if (ancestorId === descendantId) {
    const self = await prisma.administrativeUnit.findUnique({
      where: { id: ancestorId },
      select: { level: true },
    });
    if (self?.level === expectedAncestorLevel) return;
  }

  let currentId: string | null = descendantId;
  const seen = new Set<string>();
  while (currentId && !seen.has(currentId)) {
    seen.add(currentId);
    const unit: { id: string; level: string; parentId: string | null } | null =
      await prisma.administrativeUnit.findUnique({
        where: { id: currentId },
        select: { id: true, level: true, parentId: true },
      });
    if (!unit) {
      throw new NotFoundException('Administrative unit not found');
    }
    if (unit.id === ancestorId) {
      if (unit.level !== expectedAncestorLevel) {
        throw new BadRequestException(
          `Expected ancestor level ${expectedAncestorLevel}, got ${unit.level}`,
        );
      }
      return;
    }
    currentId = unit.parentId;
  }

  throw new BadRequestException(
    `administrative unit ${descendantId} does not belong under ${ancestorId}`,
  );
}

/** BFS: collect village-level units under a sector/cell (or any admin unit). */
export async function collectVillageIdsUnder(
  prisma: PrismaService,
  rootId: string,
): Promise<string[]> {
  const root = await prisma.administrativeUnit.findUnique({
    where: { id: rootId },
    select: { id: true, level: true },
  });
  if (!root) {
    throw new NotFoundException('Sector / administrative unit not found');
  }

  const villages: string[] = [];
  const queue = [root.id];
  const seen = new Set<string>();

  while (queue.length > 0) {
    const batch = queue.splice(0, 50);
    const children = await prisma.administrativeUnit.findMany({
      where: { parentId: { in: batch } },
      select: { id: true, level: true },
    });
    for (const child of children) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      if (child.level === AdministrativeLevel.village) {
        villages.push(child.id);
      } else {
        queue.push(child.id);
      }
    }
  }

  if (root.level === AdministrativeLevel.village) {
    villages.push(root.id);
  }

  return villages;
}

/**
 * Resolve sector AdministrativeUnit id for a center via village → ancestors.
 * Returns null when hierarchy cannot be resolved.
 */
export async function resolveSectorIdForCenter(
  prisma: PrismaService,
  center: { villageId: string; districtId: string },
): Promise<string | null> {
  let currentId: string | null = center.villageId;
  const seen = new Set<string>();

  while (currentId && !seen.has(currentId)) {
    seen.add(currentId);
    const unit: {
      id: string;
      level: string;
      parentId: string | null;
      districtId: string | null;
    } | null = await prisma.administrativeUnit.findUnique({
      where: { id: currentId },
      select: { id: true, level: true, parentId: true, districtId: true },
    });
    if (!unit) return null;
    if (unit.level === AdministrativeLevel.sector) {
      if (unit.districtId && unit.districtId !== center.districtId) {
        return null;
      }
      return unit.id;
    }
    currentId = unit.parentId;
  }

  return null;
}

/** Narrow center-owned list queries for portal / NCDA geographic scope. */
export type CenterOwnedListFilter = {
  centerId?: string | { in: string[] };
  center?: {
    districtId?: string;
    villageId?: string;
    district?: { provinceId: string };
    deletedAt?: null;
  };
};

export async function centerOwnedListFilter(
  prisma: PrismaService,
  user: AuthUser,
  query: ScopeQuery,
): Promise<CenterOwnedListFilter> {
  if (isCenterStaffRole(user.role)) {
    if (!user.centerId) {
      throw new ForbiddenException('Center scope is required for this role');
    }
    return { centerId: user.centerId };
  }

  if (isDistrictPortalRole(user.role) || user.role === UserRole.ncda_admin) {
    const scope = await resolveDistrictQueryScope(prisma, user, query);
    return listFilterFromScope(scope);
  }

  return {};
}

function listFilterFromScope(scope: DistrictQueryScope): CenterOwnedListFilter {
  if (scope.centerIds !== 'all') {
    if (scope.centerIds.length === 0) {
      return { centerId: { in: [] } };
    }
    return { centerId: { in: scope.centerIds } };
  }
  if (scope.villageId) {
    return { center: { villageId: scope.villageId, deletedAt: null } };
  }
  if (scope.districtId) {
    return { center: { districtId: scope.districtId, deletedAt: null } };
  }
  if (scope.provinceId) {
    return { center: { district: { provinceId: scope.provinceId }, deletedAt: null } };
  }
  return {};
}

/** Prisma where fragment for tables with `centerId` FK. */
export function centerIdWhere(scope: DistrictQueryScope): {
  centerId?: { in: string[] };
  center?: {
    districtId?: string;
    villageId?: string;
    district?: { provinceId: string };
    deletedAt?: null;
  };
} {
  if (scope.centerIds !== 'all') {
    return { centerId: { in: scope.centerIds } };
  }
  if (scope.villageId) {
    return { center: { villageId: scope.villageId, deletedAt: null } };
  }
  if (scope.districtId) {
    return { center: { districtId: scope.districtId, deletedAt: null } };
  }
  if (scope.provinceId) {
    return { center: { district: { provinceId: scope.provinceId }, deletedAt: null } };
  }
  return {};
}

export function childCenterWhere(scope: DistrictQueryScope): {
  centerId?: { in: string[] };
  center?: {
    districtId?: string;
    villageId?: string;
    district?: { provinceId: string };
    deletedAt: null;
  };
} {
  if (scope.centerIds !== 'all') {
    return { centerId: { in: scope.centerIds } };
  }
  if (scope.villageId) {
    return { center: { villageId: scope.villageId, deletedAt: null } };
  }
  if (scope.districtId) {
    return { center: { districtId: scope.districtId, deletedAt: null } };
  }
  if (scope.provinceId) {
    return { center: { district: { provinceId: scope.provinceId }, deletedAt: null } };
  }
  return {};
}

/** Prisma where for EcdCenter rows themselves. */
export function ecdCenterWhere(scope: DistrictQueryScope): {
  id?: { in: string[] };
  districtId?: string;
  villageId?: string;
  district?: { provinceId: string };
  deletedAt?: null;
} {
  const base: { deletedAt: null } = { deletedAt: null };
  if (scope.singleCenterId) {
    return { id: { in: [scope.singleCenterId] }, ...base };
  }
  if (scope.centerIds !== 'all') {
    return {
      id: { in: scope.centerIds },
      ...(scope.districtId ? { districtId: scope.districtId } : {}),
      ...base,
    };
  }
  if (scope.villageId) {
    return { villageId: scope.villageId, ...base };
  }
  if (scope.districtId) {
    return { districtId: scope.districtId, ...base };
  }
  if (scope.provinceId) {
    return { district: { provinceId: scope.provinceId }, ...base };
  }
  return base;
}

/** True when role uses district/sector portal geographic scope helpers. */
export function usesDistrictQueryScope(role: UserRole): boolean {
  return isDistrictPortalRole(role) || role === UserRole.ncda_admin;
}

/**
 * Preferred name alias for FIX-02+.
 * Same implementation as {@link resolveDistrictQueryScope}.
 */
export const resolveGeographicQueryScope = resolveDistrictQueryScope;

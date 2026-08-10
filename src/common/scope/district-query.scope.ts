import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { AdministrativeLevel, UserRole } from '@prisma/client';
import {
  assertCenterAccess,
  assertDistrictAccess,
} from '../auth/scope.util';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../../modules/auth/interfaces/jwt-payload.interface';

export type DistrictQueryScope = {
  centerIds: string[] | 'all';
  districtId: string | null;
  singleCenterId: string | null;
  sectorId: string | null;
};

export type ScopeQuery = {
  districtId?: string;
  centerId?: string;
  sectorId?: string;
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
    : new Date(
        Date.UTC(
          end.getUTCFullYear(),
          end.getUTCMonth(),
          end.getUTCDate() - defaultDays,
        ),
      );
  if (start.getTime() > end.getTime()) {
    throw new BadRequestException('`from` must be on or before `to`');
  }
  return { from: start, to: end };
}

export function startOfUtcDay(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
}

export function paginateParams(page?: number, pageSize?: number, max = 100) {
  const p = Math.max(1, page ?? 1);
  const ps = Math.min(max, Math.max(1, pageSize ?? 20));
  return { page: p, pageSize: ps, skip: (p - 1) * ps };
}

/**
 * Resolve center IDs visible to the actor, optionally narrowed by district,
 * center, or sector (villages under the sector).
 */
export async function resolveDistrictQueryScope(
  prisma: PrismaService,
  user: AuthUser,
  query: ScopeQuery,
): Promise<DistrictQueryScope> {
  if (user.role === UserRole.caregiver) {
    if (!user.centerId) {
      throw new ForbiddenException('Center scope is required for caregivers');
    }
    if (query.centerId && query.centerId !== user.centerId) {
      throw new ForbiddenException('Cannot query another center');
    }
    if (query.districtId || query.sectorId) {
      throw new ForbiddenException(
        'Caregivers cannot filter by district or sector',
      );
    }
    return {
      centerIds: [user.centerId],
      districtId: user.districtId,
      singleCenterId: user.centerId,
      sectorId: null,
    };
  }

  let districtId: string | null = null;

  if (user.role === UserRole.district_focal_person) {
    if (!user.districtId) {
      throw new ForbiddenException('District scope is required');
    }
    if (query.districtId && query.districtId !== user.districtId) {
      assertDistrictAccess(user, query.districtId);
    }
    districtId = user.districtId;
  } else if (query.districtId) {
    assertDistrictAccess(user, query.districtId);
    districtId = query.districtId;
  }

  if (query.centerId) {
    const center = await prisma.ecdCenter.findFirst({
      where: { id: query.centerId, deletedAt: null },
      select: { id: true, districtId: true, villageId: true },
    });
    if (!center) throw new NotFoundException('Center not found');
    assertCenterAccess(user, center.id, center.districtId);
    if (districtId && center.districtId !== districtId) {
      throw new BadRequestException(
        'centerId does not belong to the given districtId',
      );
    }
    return {
      centerIds: [center.id],
      districtId: center.districtId,
      singleCenterId: center.id,
      sectorId: query.sectorId ?? null,
    };
  }

  let villageFilter: string[] | undefined;
  if (query.sectorId) {
    villageFilter = await collectVillageIdsUnder(prisma, query.sectorId);
    if (villageFilter.length === 0) {
      return {
        centerIds: [],
        districtId,
        singleCenterId: null,
        sectorId: query.sectorId,
      };
    }
  }

  if (districtId) {
    const centers = await prisma.ecdCenter.findMany({
      where: {
        districtId,
        deletedAt: null,
        ...(villageFilter ? { villageId: { in: villageFilter } } : {}),
      },
      select: { id: true },
    });
    return {
      centerIds: centers.map((c) => c.id),
      districtId,
      singleCenterId: null,
      sectorId: query.sectorId ?? null,
    };
  }

  // ncda national
  if (villageFilter) {
    const centers = await prisma.ecdCenter.findMany({
      where: { deletedAt: null, villageId: { in: villageFilter } },
      select: { id: true },
    });
    return {
      centerIds: centers.map((c) => c.id),
      districtId: null,
      singleCenterId: null,
      sectorId: query.sectorId ?? null,
    };
  }

  return {
    centerIds: 'all',
    districtId: null,
    singleCenterId: null,
    sectorId: null,
  };
}

/** BFS: collect village-level units under a sector (or any admin unit). */
async function collectVillageIdsUnder(
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

export function centerIdWhere(
  scope: DistrictQueryScope,
): { centerId?: { in: string[] } } {
  if (scope.centerIds === 'all') return {};
  return { centerId: { in: scope.centerIds } };
}

export function childCenterWhere(scope: DistrictQueryScope): {
  centerId?: { in: string[] };
  center?: { districtId: string; deletedAt: null };
} {
  if (scope.centerIds === 'all') {
    if (scope.districtId) {
      return { center: { districtId: scope.districtId, deletedAt: null } };
    }
    return {};
  }
  return { centerId: { in: scope.centerIds } };
}

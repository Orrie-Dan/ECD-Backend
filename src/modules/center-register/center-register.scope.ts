import { UserRole } from '../../common/domain';
import { ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  assertCenterAdminAccess,
  isCenterAdminRole,
  isCenterStaffRole,
} from '../../common/auth/scope.util';
import { centerOwnedListFilter } from '../../common/scope/district-query.scope';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../auth/interfaces/jwt-payload.interface';

export type CenterSummary = {
  id: string;
  name: string;
  districtId: string;
  villageId: string;
};

export type DateRangedListQuery = {
  centerId?: string;
  districtId?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
};

/** Roles that may read register records within scope. */
export const REGISTER_READ_ROLES = [
  UserRole.caregiver,
  UserRole.ecd_director,
  UserRole.district_focal_person,
  UserRole.sector_focal_person,
  UserRole.ncda_admin,
] as const;

/** Roles that may create/update/archive register administrative records. */
export const REGISTER_WRITE_ROLES = [UserRole.ecd_director] as const;

/** Roles that may read derived register summaries (totals/aggregates). */
export const REGISTER_SUMMARY_ROLES = [
  UserRole.ecd_director,
  UserRole.district_focal_person,
  UserRole.sector_focal_person,
  UserRole.ncda_admin,
] as const;

export function assertCanMutateRegister(user: AuthUser): void {
  if (!isCenterAdminRole(user.role)) {
    throw new ForbiddenException('Only ECD directors can modify register records');
  }
}

export function assertCanReadRegisterSummary(user: AuthUser): void {
  if (!REGISTER_SUMMARY_ROLES.includes(user.role as (typeof REGISTER_SUMMARY_ROLES)[number])) {
    throw new ForbiddenException('You do not have access to register summaries');
  }
}

export function assertWriteCenterAccess(
  user: AuthUser,
  center: Pick<CenterSummary, 'id' | 'districtId'>,
): void {
  assertCenterAdminAccess(user, center.id, center.districtId);
}

export function paginationOf(query: { page?: number; pageSize?: number }): {
  page: number;
  pageSize: number;
  skip: number;
} {
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 20;
  return { page, pageSize, skip: (page - 1) * pageSize };
}

export async function buildCenterScopedWhere(
  prisma: PrismaService,
  user: AuthUser,
  query: DateRangedListQuery,
  dateField: string,
): Promise<Prisma.ParentContributionWhereInput> {
  const where: Prisma.ParentContributionWhereInput = {
    deletedAt: null,
  };

  const scoped = await centerOwnedListFilter(prisma, user, {
    districtId: query.districtId,
    centerId: query.centerId,
  });
  if (typeof scoped.centerId === 'string') {
    where.centerId = scoped.centerId;
  } else if (scoped.centerId) {
    where.centerId = scoped.centerId;
  } else if (scoped.center) {
    where.center = { districtId: scoped.center.districtId, deletedAt: null };
  }

  if (query.centerId) {
    if (isCenterStaffRole(user.role)) {
      if (!user.centerId || query.centerId !== user.centerId) {
        throw new ForbiddenException('Access to other centers is denied');
      }
    }
    where.centerId = query.centerId;
  }

  if (query.from || query.to) {
    const range: Prisma.DateTimeFilter = {};
    if (query.from) {
      range.gte = new Date(query.from);
    }
    if (query.to) {
      range.lte = new Date(query.to);
    }
    (where as Record<string, unknown>)[dateField] = range;
  }

  return where;
}

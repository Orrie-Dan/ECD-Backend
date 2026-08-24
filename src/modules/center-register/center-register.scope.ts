import { ForbiddenException } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import {
  assertCenterAccess,
  assertCenterAdminAccess,
  isCenterAdminRole,
  isCenterStaffRole,
} from '../../common/auth/scope.util';
import { AuthUser } from '../auth/interfaces/jwt-payload.interface';

export type CenterSummary = {
  id: string;
  name: string;
  districtId: string;
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
  UserRole.ncda_admin,
] as const;

/** Roles that may create/update/archive register administrative records. */
export const REGISTER_WRITE_ROLES = [UserRole.ecd_director] as const;

/** Roles that may read derived register summaries (totals/aggregates). */
export const REGISTER_SUMMARY_ROLES = [
  UserRole.ecd_director,
  UserRole.district_focal_person,
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

export function assertWriteCenterAccess(user: AuthUser, center: CenterSummary): void {
  assertCenterAdminAccess(user, center.id, center.districtId);
}

export function assertReadCenterAccess(user: AuthUser, center: CenterSummary): void {
  assertCenterAccess(user, center.id, center.districtId);
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

export function buildCenterScopedWhere(
  user: AuthUser,
  query: DateRangedListQuery,
  dateField: string,
): Prisma.ParentContributionWhereInput {
  const where: Prisma.ParentContributionWhereInput = {
    deletedAt: null,
  };

  if (isCenterStaffRole(user.role)) {
    if (!user.centerId) {
      throw new ForbiddenException('Center scope is required for this role');
    }
    where.centerId = user.centerId;
  } else if (user.role === UserRole.district_focal_person) {
    if (!user.districtId) {
      throw new ForbiddenException('District scope is required for district focal persons');
    }
    if (query.districtId && query.districtId !== user.districtId) {
      throw new ForbiddenException('Access to other districts is denied');
    }
    where.center = { districtId: user.districtId };
  } else if (user.role === UserRole.ncda_admin) {
    if (query.districtId) {
      where.center = { districtId: query.districtId };
    }
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

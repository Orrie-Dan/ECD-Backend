import { ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { UserContext } from '../interfaces/user-context.interface';

/** Fields required for scope decisions (subset of UserContext). */
export type ScopeUser = Pick<UserContext, 'role' | 'centerId' | 'districtId'>;

/** Center-assigned operational staff (caregiver and ECD director / head of ECD). */
export function isCenterStaffRole(role: UserRole): boolean {
  return role === UserRole.caregiver || role === UserRole.ecd_director;
}

/** Centre administration authority (ECD director / centre manager). */
export function isCenterAdminRole(role: UserRole): boolean {
  return role === UserRole.ecd_director;
}

/**
 * Caregiver / ECD director: own center only.
 * District focal: centers in their district (pass centerDistrictId).
 * NCDA: unrestricted.
 */
export function canAccessCenter(
  user: ScopeUser,
  centerId: string,
  centerDistrictId?: string | null,
): boolean {
  if (user.role === UserRole.ncda_admin) {
    return true;
  }

  if (isCenterStaffRole(user.role)) {
    return user.centerId != null && user.centerId === centerId;
  }

  if (user.role === UserRole.district_focal_person) {
    if (!user.districtId || centerDistrictId == null) {
      return false;
    }
    return user.districtId === centerDistrictId;
  }

  return false;
}

/**
 * District focal: own district only.
 * NCDA: unrestricted.
 * Center staff: not district-scoped (denied).
 */
export function canAccessDistrict(user: ScopeUser, districtId: string): boolean {
  if (user.role === UserRole.ncda_admin) {
    return true;
  }

  if (user.role === UserRole.district_focal_person) {
    return user.districtId != null && user.districtId === districtId;
  }

  return false;
}

export function assertCenterAccess(
  user: ScopeUser,
  centerId: string,
  centerDistrictId?: string | null,
): void {
  if (!canAccessCenter(user, centerId, centerDistrictId)) {
    throw new ForbiddenException(`You do not have access to center ${centerId} (${user.role})`);
  }
}

/**
 * Centre administration: ECD director assigned to the target centre only.
 * Membership (caregiver) or district/NCDA read scope is not sufficient.
 */
export function canAdministerCenter(
  user: ScopeUser,
  centerId: string,
  centerDistrictId?: string | null,
): boolean {
  return isCenterAdminRole(user.role) && canAccessCenter(user, centerId, centerDistrictId);
}

export function assertCenterAdminAccess(
  user: ScopeUser,
  centerId: string,
  centerDistrictId?: string | null,
): void {
  if (!canAdministerCenter(user, centerId, centerDistrictId)) {
    throw new ForbiddenException(
      `You do not have administration authority for center ${centerId} (${user.role})`,
    );
  }
}

export function assertDistrictAccess(user: ScopeUser, districtId: string): void {
  if (!canAccessDistrict(user, districtId)) {
    throw new ForbiddenException(`You do not have access to district ${districtId} (${user.role})`);
  }
}

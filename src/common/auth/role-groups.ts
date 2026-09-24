import { UserRole } from '../domain';

/** District + sector portal operators (same API surface, different geographic pin). */
export const DISTRICT_PORTAL_ROLES = [
  UserRole.district_focal_person,
  UserRole.sector_focal_person,
] as const;

export type DistrictPortalRole = (typeof DISTRICT_PORTAL_ROLES)[number];

/** Portal operators plus NCDA (district-scoped admin endpoints). */
export const DISTRICT_PORTAL_AND_NCDA_ROLES = [
  ...DISTRICT_PORTAL_ROLES,
  UserRole.ncda_admin,
] as const;

/** Field staff + portal + NCDA read access (lists, dashboards, alerts). */
export const CENTER_AND_PORTAL_READ_ROLES = [
  UserRole.caregiver,
  UserRole.ecd_director,
  ...DISTRICT_PORTAL_ROLES,
  UserRole.ncda_admin,
] as const;

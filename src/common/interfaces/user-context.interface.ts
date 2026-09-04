import { UserRole } from '../domain';
/**
 * Minimal authenticated user fields required for scope checks.
 * Aligns with JWT / CurrentUser context without pulling auth-module types.
 */
export interface UserContext {
  id: string;
  username: string;
  role: UserRole;
  districtId: string | null;
  centerId: string | null;
}

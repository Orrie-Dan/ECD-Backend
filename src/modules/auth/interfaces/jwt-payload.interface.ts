import { UserRole } from '../../../common/domain';
import { UserContext } from '../../../common/interfaces/user-context.interface';

export interface JwtPayload {
  sub: string;
  username: string;
  role: UserRole;
  districtId: string | null;
  centerId: string | null;
  type: 'access' | 'refresh';
}

/**
 * Authenticated request user (Passport / CurrentUser).
 * Extends shared UserContext with profile fields loaded by JwtStrategy.
 */
export interface AuthUser extends UserContext {
  email: string | null;
  fullName: string;
  status: string;
}

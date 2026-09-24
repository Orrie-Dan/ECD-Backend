export { UserContext } from './interfaces/user-context.interface';
export {
  CENTER_AND_PORTAL_READ_ROLES,
  DISTRICT_PORTAL_AND_NCDA_ROLES,
  DISTRICT_PORTAL_ROLES,
  type DistrictPortalRole,
} from './auth/role-groups';
export {
  assertCenterAccess,
  assertCenterAdminAccess,
  assertDistrictAccess,
  canAccessCenter,
  canAccessDistrict,
  canAdministerCenter,
  isCenterAdminRole,
  isCenterStaffRole,
  isDistrictPortalRole,
  type ScopeUser,
} from './auth/scope.util';
export {
  applyAuthenticatedGeographicQuery,
  centerOwnedListFilter,
  assertCenterAccessible,
  assertCenterAccessibleById,
  collectVillageIdsUnder,
  resolveDistrictQueryScope,
  resolveSectorIdForCenter,
  type DistrictQueryScope,
  type ScopeQuery,
} from './scope/district-query.scope';
export type { BidirectionalMapper, Mapper } from './mappers/base.mapper';
export {
  assertCasApplied,
  classifyCasMiss,
  type CasClassifyResult,
  type CasMissLookup,
} from './concurrency/cas.util';
export {
  OptimisticLockConflictException,
  type OptimisticLockConflictBody,
} from './concurrency/optimistic-lock.exception';
export {
  AuditAction,
  AuditModule,
  AuditService,
  fromPrismaAuditAction,
  toAuditJson,
  toPrismaAuditAction,
  type AuditActorType,
  type AuditContext,
  type AuditMetadata,
} from './audit';
export {
  ApiAuthErrors,
  ApiDeviceIdHeader,
  ApiNotFoundError,
  ApiOptimisticLockConflict,
  ApiStandardClientErrors,
  ConflictResponseDto,
  ErrorResponseDto,
} from './swagger';

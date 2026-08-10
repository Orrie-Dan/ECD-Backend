export { UserContext } from './interfaces/user-context.interface';
export {
  assertCenterAccess,
  assertDistrictAccess,
  canAccessCenter,
  canAccessDistrict,
  type ScopeUser,
} from './auth/scope.util';
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

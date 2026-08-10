import { ConflictException, HttpStatus } from '@nestjs/common';

export type OptimisticLockConflictBody = {
  statusCode: number;
  message: string;
  entity: string;
  currentVersion?: number;
};

/**
 * HTTP 409 for optimistic locking failures (stale client version).
 * Response shape is consumed by AllExceptionsFilter.
 */
export class OptimisticLockConflictException extends ConflictException {
  readonly entity: string;
  readonly currentVersion?: number;

  constructor(entity: string, currentVersion?: number) {
    const body: OptimisticLockConflictBody = {
      statusCode: HttpStatus.CONFLICT,
      message: 'Record was modified by another device',
      entity,
      ...(currentVersion != null ? { currentVersion } : {}),
    };
    super(body);
    this.entity = entity;
    this.currentVersion = currentVersion;
  }
}

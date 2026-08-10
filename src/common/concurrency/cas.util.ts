import { NotFoundException } from '@nestjs/common';
import { OptimisticLockConflictException } from './optimistic-lock.exception';

export type CasMissLookup = () => Promise<{ version: number } | null>;

/**
 * After updateMany/deleteMany CAS, count must be 1.
 * Distinguishes not-found vs version conflict without leaking internals.
 */
export async function assertCasApplied(
  count: number,
  entity: string,
  findCurrent: CasMissLookup,
): Promise<void> {
  if (count === 1) {
    return;
  }

  const existing = await findCurrent();
  if (!existing) {
    throw new NotFoundException(
      `${entity.charAt(0).toUpperCase()}${entity.slice(1)} not found`,
    );
  }

  throw new OptimisticLockConflictException(entity, existing.version);
}

export type CasClassifyResult =
  | { kind: 'applied' }
  | { kind: 'not_found' }
  | { kind: 'version_mismatch'; serverVersion: number };

/** Non-throwing classification for batch item outcomes. */
export async function classifyCasMiss(
  count: number,
  findCurrent: CasMissLookup,
): Promise<CasClassifyResult> {
  if (count === 1) {
    return { kind: 'applied' };
  }
  const existing = await findCurrent();
  if (!existing) {
    return { kind: 'not_found' };
  }
  return { kind: 'version_mismatch', serverVersion: existing.version };
}

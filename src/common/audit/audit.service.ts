import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { toPrismaAuditAction } from './audit-action';
import {
  AuditActorType,
  AuditContext,
  AuditMetadata,
} from './audit-context';

/**
 * Central domain audit writer.
 *
 * Old/new value strategy (Option A — full snapshots):
 * Store complete entity snapshots in oldValues/newValues for compliance
 * reconstructability. Diffs can be derived at query time. Prefer serializing
 * plain row fields (strip heavy relation graphs) via toAuditJson().
 *
 * Actor attribution:
 * - REST: userId → changedById
 * - Offline sync: deviceId + operationId in metadata
 * - Background/system: actorType=system, userId null
 *
 * Always call inside the same Prisma transaction as the business mutation.
 */
@Injectable()
export class AuditService {
  async log(context: AuditContext): Promise<void> {
    const actorType = resolveActorType(context);
    const metadata = buildMetadata(context, actorType);

    await context.tx.auditLog.create({
      data: {
        id: randomUUID(),
        entityType: context.entityType,
        entityId: context.entityId,
        action: toPrismaAuditAction(context.action),
        changedById: context.userId ?? null,
        changedAt: context.changedAt ?? new Date(),
        oldValues: toJsonNullable(context.oldValues),
        newValues: toJsonNullable(context.newValues),
        metadata: metadata as Prisma.InputJsonValue,
      },
    });
  }
}

function resolveActorType(context: AuditContext): AuditActorType {
  if (context.actorType) {
    return context.actorType;
  }
  if (context.deviceId) {
    return 'device';
  }
  if (context.userId) {
    return 'user';
  }
  return 'system';
}

function buildMetadata(
  context: AuditContext,
  actorType: AuditActorType,
): AuditMetadata {
  const metadata: AuditMetadata = {
    domainAction: context.action,
    actorType,
    ...(context.deviceId ? { deviceId: context.deviceId } : {}),
    ...(context.operationId ? { operationId: context.operationId } : {}),
    ...(context.metadata ?? {}),
  };
  return metadata;
}

/** JSON-null when value is null/undefined; otherwise a Prisma JSON value. */
export function toJsonNullable(
  value: unknown | null | undefined,
): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (value === null || value === undefined) {
    return Prisma.JsonNull;
  }
  return toAuditJson(value);
}

/**
 * Convert Prisma models / Decimals / Dates into plain JSON-safe snapshots.
 * Drops nested objects that look like relation graphs when `plain` is used
 * by callers; this helper itself deep-serializes what it is given.
 */
export function toAuditJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(
    JSON.stringify(value, (_key, v) => {
      if (v instanceof Date) {
        return v.toISOString();
      }
      if (v != null && typeof v === 'object' && typeof v.toNumber === 'function') {
        return v.toNumber();
      }
      if (typeof v === 'bigint') {
        return v.toString();
      }
      return v;
    }),
  ) as Prisma.InputJsonValue;
}

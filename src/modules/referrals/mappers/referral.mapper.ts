import {
  Referral,
  ReferralSourceType,
  ReferralStatus,
} from '@prisma/client';
import { Mapper } from '../../../common/mappers/base.mapper';
import { CreateReferralDto } from '../dto/create-referral.dto';
import {
  ApiReferralSourceType,
  ApiReferralStatus,
  ReferralResponseDto,
} from '../dto/referral-response.dto';

export type ReferralEntity = Referral;

export type ReferralCreateMapped = {
  sourceType: ReferralSourceType;
  referralDate: Date;
  reason: string;
  destination: string;
  notes: string | null;
};

function toDateKey(value: Date | string | null | undefined): string | null {
  if (value == null) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return String(value).slice(0, 10);
}

export function toApiReferralStatus(status: ReferralStatus): ApiReferralStatus {
  switch (status) {
    case ReferralStatus.pending:
      return 'pending';
    case ReferralStatus.completed:
      return 'completed';
    case ReferralStatus.cancelled:
      return 'cancelled';
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

export function toDbReferralStatus(status: ApiReferralStatus): ReferralStatus {
  switch (status) {
    case 'pending':
      return ReferralStatus.pending;
    case 'completed':
      return ReferralStatus.completed;
    case 'cancelled':
      return ReferralStatus.cancelled;
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

export function toApiReferralSourceType(
  sourceType: ReferralSourceType,
): ApiReferralSourceType {
  switch (sourceType) {
    case ReferralSourceType.nutrition:
      return 'nutrition';
    case ReferralSourceType.sted:
      return 'sted';
    default: {
      const _exhaustive: never = sourceType;
      return _exhaustive;
    }
  }
}

export function toDbReferralSourceType(
  sourceType: ApiReferralSourceType,
): ReferralSourceType {
  switch (sourceType) {
    case 'nutrition':
      return ReferralSourceType.nutrition;
    case 'sted':
      return ReferralSourceType.sted;
    default: {
      const _exhaustive: never = sourceType;
      return _exhaustive;
    }
  }
}

/**
 * Resolve source type from sync payload (API string or Prisma enum).
 */
export function resolveReferralSourceTypeFromPayload(
  payload: Record<string, unknown>,
): ReferralSourceType {
  const raw = payload.sourceType;
  if (raw === 'nutrition' || raw === ReferralSourceType.nutrition) {
    return ReferralSourceType.nutrition;
  }
  if (raw === 'sted' || raw === ReferralSourceType.sted) {
    return ReferralSourceType.sted;
  }
  throw new Error('referral requires sourceType of nutrition or sted');
}

/**
 * Resolve status from sync payload (API string or Prisma enum).
 */
export function resolveReferralStatusFromPayload(
  payload: Record<string, unknown>,
): ReferralStatus {
  const raw = payload.status;
  if (raw === 'pending' || raw === ReferralStatus.pending) {
    return ReferralStatus.pending;
  }
  if (raw === 'completed' || raw === ReferralStatus.completed) {
    return ReferralStatus.completed;
  }
  if (raw === 'cancelled' || raw === ReferralStatus.cancelled) {
    return ReferralStatus.cancelled;
  }
  throw new Error('referral requires status of pending, completed, or cancelled');
}

/** pending → completed | cancelled; terminal states cannot change. */
export function canTransitionReferralStatus(
  from: ReferralStatus,
  to: ReferralStatus,
): boolean {
  if (from !== ReferralStatus.pending) {
    return false;
  }
  return to === ReferralStatus.completed || to === ReferralStatus.cancelled;
}

export class ReferralMapper
  implements Mapper<ReferralEntity, ReferralResponseDto>
{
  toDto(entity: ReferralEntity): ReferralResponseDto {
    return {
      id: entity.id,
      childId: entity.childId,
      centerId: entity.centerId,
      sourceType: toApiReferralSourceType(entity.sourceType),
      sourceId: entity.sourceId,
      referralDate: toDateKey(entity.referralDate)!,
      reason: entity.reason,
      destination: entity.destination,
      status: toApiReferralStatus(entity.status),
      implementedAt: toDateKey(entity.implementedAt),
      notes: entity.notes,
      recordedBy: entity.recordedById,
      version: entity.version,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }

  toCreateData(dto: CreateReferralDto): ReferralCreateMapped {
    return {
      sourceType: toDbReferralSourceType(dto.sourceType),
      referralDate: new Date(
        `${dto.referralDate.slice(0, 10)}T00:00:00.000Z`,
      ),
      reason: dto.reason.trim(),
      destination: dto.destination.trim(),
      notes: dto.notes?.trim() || null,
    };
  }
}

export const referralMapper = new ReferralMapper();

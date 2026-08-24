import { CenterFeedingDay, CenterFeedingMonthSummary, Prisma } from '@prisma/client';
import { Mapper } from '../../../common/mappers/base.mapper';
import { FeedingDayResponseDto, FeedingMonthSummaryResponseDto } from '../dto/feeding-response.dto';
import { UpsertFeedingDayDto } from '../dto/upsert-feeding-day.dto';
import { UpsertFeedingMonthSummaryDto } from '../dto/upsert-feeding-month-summary.dto';

const SIX_FOOD_GROUPS = [
  'cerealsOrTubers',
  'legumes',
  'dairy',
  'animalProducts',
  'fruitsVegetables',
  'addedFat',
] as const;

export function decimalToNumber(
  value: Prisma.Decimal | number | string | null | undefined,
): number {
  if (value == null) {
    return 0;
  }
  if (typeof value === 'number') {
    return value;
  }
  return Number(value.toString());
}

export function balancedMealWarnings(dto: {
  balancedMealServed: boolean;
  cerealsOrTubers: boolean;
  legumes: boolean;
  dairy: boolean;
  animalProducts: boolean;
  fruitsVegetables: boolean;
  addedFat: boolean;
}): string[] {
  if (!dto.balancedMealServed) {
    return [];
  }

  const missing = SIX_FOOD_GROUPS.filter((key) => !dto[key]);
  if (missing.length === 0) {
    return [];
  }

  return [`balancedMealServed=true but food groups incomplete: ${missing.join(', ')}`];
}

export class FeedingMapper implements Mapper<CenterFeedingDay, FeedingDayResponseDto> {
  toDto(entity: CenterFeedingDay, warnings: string[] = []): FeedingDayResponseDto {
    return {
      id: entity.id,
      centerId: entity.centerId,
      recordedDate: entity.recordedDate,
      milkServed: entity.milkServed,
      porridgeServed: entity.porridgeServed,
      balancedMealServed: entity.balancedMealServed,
      cerealsOrTubers: entity.cerealsOrTubers,
      legumes: entity.legumes,
      dairy: entity.dairy,
      animalProducts: entity.animalProducts,
      fruitsVegetables: entity.fruitsVegetables,
      addedFat: entity.addedFat,
      recordedBy: entity.recordedById,
      recordedAt: entity.createdAt,
      version: entity.version,
      warnings,
    };
  }

  toMonthDto(entity: CenterFeedingMonthSummary): FeedingMonthSummaryResponseDto {
    return {
      id: entity.id,
      centerId: entity.centerId,
      yearMonth: entity.yearMonth,
      milkLiters: decimalToNumber(entity.milkLiters),
      flourKg: decimalToNumber(entity.flourKg),
      foodSource: entity.foodSource,
      recordedBy: entity.updatedById,
      recordedAt: entity.updatedAt,
      version: entity.version,
    };
  }

  toDayWriteData(dto: UpsertFeedingDayDto): {
    milkServed: boolean;
    porridgeServed: boolean;
    balancedMealServed: boolean;
    cerealsOrTubers: boolean;
    legumes: boolean;
    dairy: boolean;
    animalProducts: boolean;
    fruitsVegetables: boolean;
    addedFat: boolean;
  } {
    return {
      milkServed: dto.milkServed,
      porridgeServed: dto.porridgeServed,
      balancedMealServed: dto.balancedMealServed,
      cerealsOrTubers: dto.cerealsOrTubers,
      legumes: dto.legumes,
      dairy: dto.dairy,
      animalProducts: dto.animalProducts,
      fruitsVegetables: dto.fruitsVegetables,
      addedFat: dto.addedFat,
    };
  }

  toMonthWriteData(dto: UpsertFeedingMonthSummaryDto): {
    milkLiters: Prisma.Decimal;
    flourKg: Prisma.Decimal;
    foodSource: string;
  } {
    return {
      milkLiters: new Prisma.Decimal(dto.milkLiters),
      flourKg: new Prisma.Decimal(dto.flourKg),
      foodSource: dto.foodSource.trim(),
    };
  }
}

export const feedingMapper = new FeedingMapper();

/**
 * Resolve feeding-day date from sync CREATE/UPDATE payload.
 * Accepts recordedDate (canonical) or date (attendance-style / harness alias).
 * Validates before Prisma so Invalid Date never reaches the driver (that left
 * ops stuck at pending with null conflictReason on LIVE).
 */
export function resolveFeedingRecordedDateFromPayload(payload: Record<string, unknown>): Date {
  const raw = payload.recordedDate ?? payload.date ?? null;
  if (raw == null || raw === '') {
    throw new Error('center_feeding_day requires recordedDate (or date)');
  }
  const asString = raw instanceof Date ? raw.toISOString().slice(0, 10) : String(raw).trim();
  if (!asString || asString === 'undefined' || asString === 'null') {
    throw new Error('center_feeding_day requires recordedDate (or date)');
  }
  const recordedDate = new Date(asString);
  if (Number.isNaN(recordedDate.getTime())) {
    throw new Error(`center_feeding_day recordedDate is invalid: ${asString}`);
  }
  return recordedDate;
}

/**
 * Resolve recordedBy for feeding-day sync CREATE.
 * Accepts recordedById / recordedBy. Never coerces missing values to the
 * string "undefined" (that caused P2003 retry loops → session stuck started).
 */
export function resolveFeedingRecordedByIdFromPayload(payload: Record<string, unknown>): string {
  const raw = payload.recordedById ?? payload.recordedBy;
  if (typeof raw !== 'string') {
    throw new Error('center_feeding_day requires recordedById (or recordedBy)');
  }
  const trimmed = raw.trim();
  if (!trimmed || trimmed === 'undefined' || trimmed === 'null') {
    throw new Error('center_feeding_day requires recordedById (or recordedBy)');
  }
  return trimmed;
}

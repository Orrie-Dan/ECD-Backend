import { NutritionStatus } from '../../../common/domain';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

/** Empty / blank optional numerics → undefined (never 0 from ""). */
function optionalNumber({ value }: { value: unknown }): number | undefined {
  if (value === '' || value === null || value === undefined) return undefined;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string' && value.trim() === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Legacy absolute-MUAC nutritionStatus is optional.
 * New clients omit it; WHO zones are calculated server-side from measurements + child DOB/sex.
 * Older offline payloads may still send nutritionStatus — accepted for compatibility, not used as truth.
 */
export class CreateNutritionScreeningDto {
  @ApiProperty({
    type: String,
    format: 'date',
    example: '2026-08-06',
  })
  @IsDateString()
  screeningDate: string;

  @ApiProperty({ example: 12.5, minimum: 0.001, description: 'Weight in kilograms' })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  weightKg: number;

  @ApiProperty({
    example: 14.2,
    minimum: 0.001,
    description: 'Mid-upper arm circumference in centimetres',
  })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  muacCm: number;

  @ApiPropertyOptional({
    enum: NutritionStatus,
    enumName: 'NutritionStatus',
    example: NutritionStatus.normal,
    description:
      'Deprecated legacy absolute-MUAC status. Optional for backward compatibility with older clients. Not used as nutrition source of truth.',
  })
  @IsOptional()
  @IsEnum(NutritionStatus)
  nutritionStatus?: NutritionStatus;

  @ApiPropertyOptional({ example: 85.0, minimum: 0.001, description: 'Height in centimetres' })
  @IsOptional()
  @Transform(optionalNumber)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  heightCm?: number;

  @ApiPropertyOptional({
    example: 48.0,
    minimum: 0.001,
    description: 'Head circumference in centimetres',
  })
  @IsOptional()
  @Transform(optionalNumber)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  headCircumferenceCm?: number;

  @ApiPropertyOptional({ maxLength: 100, example: 'Balanced' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  mealQuality?: string;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  feedingConcern?: boolean;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  dietNotes?: string;

  @ApiPropertyOptional({
    example: false,
    description:
      'Manual referral flag only. Automatic referral from legacy MUAC status or WHO zones is not applied (no approved WHO referral rule).',
  })
  @IsOptional()
  @IsBoolean()
  requiresReferral?: boolean;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Optional client device ID for audit trail (also accepted via x-device-id header)',
  })
  @IsOptional()
  @IsUUID()
  deviceId?: string;
}

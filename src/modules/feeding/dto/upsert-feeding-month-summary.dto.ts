import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class UpsertFeedingMonthSummaryDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  centerId: string;

  @ApiProperty({
    example: '2026-08',
    description: 'Year-month in YYYY-MM format',
    pattern: '^\\d{4}-\\d{2}$',
  })
  @Matches(/^\d{4}-\d{2}$/)
  yearMonth: string;

  @ApiProperty({ example: 120.5, minimum: 0 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  milkLiters: number;

  @ApiProperty({ example: 50.0, minimum: 0 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  flourKg: number;

  @ApiProperty({ example: 'Local market', minLength: 1, maxLength: 255 })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  foodSource: string;

  /**
   * Required when updating an existing center+yearMonth summary.
   * Omit on first create.
   */
  @ApiPropertyOptional({
    description:
      'Required when updating an existing center+yearMonth summary (optimistic locking). Omit on first create.',
    example: 1,
    minimum: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  version?: number;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Optional client device ID for audit trail (also accepted via x-device-id header)',
  })
  @IsOptional()
  @IsUUID()
  deviceId?: string;
}

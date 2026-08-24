import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsInt, IsOptional, IsUUID, Min } from 'class-validator';

export class UpsertFeedingDayDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  centerId: string;

  @ApiProperty({
    type: String,
    format: 'date',
    example: '2026-08-06',
  })
  @IsDateString()
  recordedDate: string;

  @ApiProperty({ example: true })
  @IsBoolean()
  milkServed: boolean;

  @ApiProperty({ example: true })
  @IsBoolean()
  porridgeServed: boolean;

  @ApiProperty({ example: true })
  @IsBoolean()
  balancedMealServed: boolean;

  @ApiProperty({ example: true })
  @IsBoolean()
  cerealsOrTubers: boolean;

  @ApiProperty({ example: false })
  @IsBoolean()
  legumes: boolean;

  @ApiProperty({ example: true })
  @IsBoolean()
  dairy: boolean;

  @ApiProperty({ example: false })
  @IsBoolean()
  animalProducts: boolean;

  @ApiProperty({ example: true })
  @IsBoolean()
  fruitsVegetables: boolean;

  @ApiProperty({ example: false })
  @IsBoolean()
  addedFat: boolean;

  /**
   * Required when updating an existing center+date feeding day.
   * Omit on first create.
   */
  @ApiPropertyOptional({
    description:
      'Required when updating an existing center+date feeding day (optimistic locking). Omit on first create.',
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
    description: 'Optional client device ID for audit trail (also accepted via x-device-id header)',
  })
  @IsOptional()
  @IsUUID()
  deviceId?: string;
}

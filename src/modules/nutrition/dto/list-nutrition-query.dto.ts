import { NutritionStatus } from '../../../common/domain';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsIn, IsOptional, IsUUID } from 'class-validator';

const ALERT_TYPES = [
  'overdue_screening',
  'requires_referral',
  'who_growth_concern',
  /** @deprecated alias for who_growth_concern */
  'severe_nutrition',
] as const;

export class ListNutritionQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  districtId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  centerId?: string;

  @ApiPropertyOptional({ type: String, format: 'date', example: '2026-08-06' })
  @IsOptional()
  @IsDateString()
  date?: string;

  @ApiPropertyOptional({
    enum: ALERT_TYPES,
    enumName: 'NutritionAlertType',
    description: 'Filter by nutrition alert type',
  })
  @IsOptional()
  @IsIn([...ALERT_TYPES])
  status?: (typeof ALERT_TYPES)[number];

  @ApiPropertyOptional({
    enum: NutritionStatus,
    enumName: 'NutritionStatus',
  })
  @IsOptional()
  @IsEnum(NutritionStatus)
  nutritionStatus?: NutritionStatus;
}

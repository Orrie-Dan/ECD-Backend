import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsEnum,
  IsIn,
  IsOptional,
  IsUUID,
} from 'class-validator';
import { NutritionStatus } from '@prisma/client';
import { NutritionAlertType } from './nutrition-alert.dto';

const ALERT_TYPES: NutritionAlertType[] = [
  'overdue_screening',
  'requires_referral',
  'severe_nutrition',
];

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
  @IsIn(ALERT_TYPES)
  status?: NutritionAlertType;

  @ApiPropertyOptional({
    enum: NutritionStatus,
    enumName: 'NutritionStatus',
  })
  @IsOptional()
  @IsEnum(NutritionStatus)
  nutritionStatus?: NutritionStatus;
}

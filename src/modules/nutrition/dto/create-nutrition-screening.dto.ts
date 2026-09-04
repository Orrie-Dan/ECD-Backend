import { NutritionStatus } from '../../../common/domain';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
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

  @ApiProperty({
    enum: NutritionStatus,
    enumName: 'NutritionStatus',
    example: NutritionStatus.normal,
  })
  @IsEnum(NutritionStatus)
  nutritionStatus: NutritionStatus;

  @ApiPropertyOptional({ example: 85.0, minimum: 0.001, description: 'Height in centimetres' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  heightCm?: number;

  @ApiPropertyOptional({
    example: 48.0,
    minimum: 0.001,
    description: 'Head circumference in centimetres',
  })
  @IsOptional()
  @Type(() => Number)
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

  @ApiPropertyOptional({ example: false })
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

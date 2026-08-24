import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiReferralSourceType } from './referral-response.dto';

const API_SOURCE_TYPES: ApiReferralSourceType[] = ['nutrition', 'sted'];

export class CreateReferralDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  childId: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  centerId: string;

  @ApiProperty({
    enum: API_SOURCE_TYPES,
    enumName: 'ApiReferralSourceType',
    example: 'nutrition',
  })
  @IsIn(API_SOURCE_TYPES)
  sourceType: ApiReferralSourceType;

  @ApiProperty({
    format: 'uuid',
    description: 'ID of the source nutrition screening or STED assessment',
  })
  @IsUUID()
  sourceId: string;

  @ApiProperty({
    type: String,
    format: 'date',
    example: '2026-08-06',
  })
  @IsDateString()
  referralDate: string;

  @ApiProperty({ example: 'Severe malnutrition', minLength: 1, maxLength: 500 })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason: string;

  @ApiProperty({ example: 'District hospital', minLength: 1, maxLength: 500 })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  destination: string;

  @ApiPropertyOptional({ maxLength: 5000 })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Optional client device ID for audit trail (also accepted via x-device-id header)',
  })
  @IsOptional()
  @IsUUID()
  deviceId?: string;
}

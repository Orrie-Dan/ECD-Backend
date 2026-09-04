import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { ApiStedAgeBand } from './sted-response.dto';

const API_AGE_BANDS: ApiStedAgeBand[] = ['1_3', '4_6'];

export class CreateStedAssessmentDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  childId: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  centerId: string;

  @ApiProperty({
    type: String,
    format: 'date',
    example: '2026-08-06',
  })
  @IsDateString()
  assessmentDate: string;

  @ApiProperty({
    enum: API_AGE_BANDS,
    enumName: 'ApiStedAgeBand',
    example: '1_3',
  })
  @IsIn(API_AGE_BANDS)
  ageBand: ApiStedAgeBand;

  @ApiProperty({ example: true })
  @IsBoolean()
  consentObtained: boolean;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description: 'Physical assessment results as a free-form JSON object',
  })
  @IsObject()
  @IsNotEmpty()
  physicalAssessment: Record<string, unknown>;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description: 'Milestone results as a free-form JSON object',
  })
  @IsObject()
  @IsNotEmpty()
  milestoneResults: Record<string, unknown>;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description: 'Assessment outcome as a free-form JSON object',
  })
  @IsObject()
  @IsNotEmpty()
  outcome: Record<string, unknown>;

  @ApiProperty({ example: true })
  @IsBoolean()
  followUpIn6Months: boolean;

  @ApiPropertyOptional({
    type: String,
    format: 'date',
    example: '2027-02-06',
  })
  @IsOptional()
  @IsDateString()
  followUpDueDate?: string;

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

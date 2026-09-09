import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

const SELF_EVAL_RANKS = ['green', 'blue', 'yellow', 'red'] as const;

export class SubmitSelfEvaluationDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  centerId: string;

  @ApiProperty({ example: 'daycare', description: 'Facility checklist id (daycare | ecd_3_5)' })
  @IsString()
  facilityTypeId: string;

  @ApiProperty({ example: '2024.1' })
  @IsString()
  standardsVersion: string;

  @ApiProperty({
    example: '2026-09-08',
    description: 'Assessment date (ISO date string)',
  })
  @IsDateString()
  assessmentDate: string;

  @ApiProperty({ example: 168, description: 'Earned weighted points' })
  @IsNumber()
  @Min(0)
  earnedScore: number;

  @ApiProperty({ example: 199, description: 'Maximum weighted points for the checklist' })
  @IsNumber()
  @Min(1)
  maxScore: number;

  @ApiProperty({ example: 84, description: 'Rounded compliance percent 0–100' })
  @IsInt()
  @Min(0)
  @Max(100)
  percent: number;

  @ApiProperty({ enum: SELF_EVAL_RANKS, example: 'blue' })
  @IsIn(SELF_EVAL_RANKS)
  rank: (typeof SELF_EVAL_RANKS)[number];

  @ApiPropertyOptional({
    example: 'Client-side draft id for audit correlation',
  })
  @IsOptional()
  @IsString()
  clientDraftId?: string;
}

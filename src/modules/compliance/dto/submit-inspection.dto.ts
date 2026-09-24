import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { SubmitSelfEvaluationItemDto } from './submit-self-evaluation.dto';

const INSPECTION_RANKS = ['green', 'blue', 'yellow', 'red'] as const;

/**
 * Submit a supportive_supervision inspection.
 * Client scores are asserted against backend recalculation (same as self-evaluation).
 */
export class SubmitInspectionDto {
  @ApiProperty({ example: 'daycare', description: 'Facility checklist id (daycare | ecd_3_5)' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  facilityTypeId: string;

  @ApiProperty({ example: '2024.2-weighted' })
  @IsString()
  @IsNotEmpty()
  standardsVersion: string;

  @ApiProperty({
    example: '2026-09-23',
    description: 'Assessment date (ISO date string)',
  })
  @IsDateString()
  assessmentDate: string;

  @ApiProperty({ example: 168, description: 'Earned weighted points (must match backend)' })
  @IsNumber()
  @Min(0)
  earnedScore: number;

  @ApiProperty({ example: 230, description: 'Maximum weighted points (must match backend)' })
  @IsNumber()
  @Min(1)
  maxScore: number;

  @ApiProperty({ example: 73, description: 'Rounded compliance percent 0–100 (must match backend)' })
  @IsInt()
  @Min(0)
  @Max(100)
  percent: number;

  @ApiProperty({ enum: INSPECTION_RANKS, example: 'blue' })
  @IsIn(INSPECTION_RANKS)
  rank: (typeof INSPECTION_RANKS)[number];

  @ApiProperty({
    type: [SubmitSelfEvaluationItemDto],
    description: 'Complete Yes/No answers keyed by checklist question id',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => SubmitSelfEvaluationItemDto)
  items: SubmitSelfEvaluationItemDto[];
}

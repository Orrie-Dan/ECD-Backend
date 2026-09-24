import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

const SELF_EVAL_RANKS = ['green', 'blue', 'yellow', 'red'] as const;

export class SubmitSelfEvaluationItemDto {
  @ApiProperty({
    example: 'dc_s711_pregnant_anc_access',
    description: 'Stable checklist question id; stored as EcdStandard.code',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  questionId: string;

  @ApiProperty({
    example: true,
    description: 'true = met (Yes), false = not_met (No)',
  })
  @IsBoolean()
  response: boolean;
}

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

  @ApiProperty({
    type: [SubmitSelfEvaluationItemDto],
    description: 'Individual Yes/No answers keyed by checklist question id',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => SubmitSelfEvaluationItemDto)
  items: SubmitSelfEvaluationItemDto[];

  @ApiPropertyOptional({
    example: 'Client-side draft id for audit correlation',
  })
  @IsOptional()
  @IsString()
  clientDraftId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Existing server draft assessment id to finalize in place',
  })
  @IsOptional()
  @IsUUID()
  assessmentId?: string;
}

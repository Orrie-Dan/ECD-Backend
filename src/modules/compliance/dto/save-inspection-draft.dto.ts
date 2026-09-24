import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsNotEmpty,
  IsString,
  ValidateNested,
} from 'class-validator';
import { SubmitSelfEvaluationItemDto } from './submit-self-evaluation.dto';

/**
 * Batch draft answers for a supportive_supervision inspection.
 * Partial answers allowed. Omitted questionIds are removed from the draft.
 */
export class SaveInspectionDraftDto {
  @ApiProperty({ example: 'daycare', description: 'Facility checklist id (daycare | ecd_3_5)' })
  @IsString()
  @IsNotEmpty()
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

  @ApiProperty({
    type: [SubmitSelfEvaluationItemDto],
    description:
      'Authoritative current Yes/No answers keyed by checklist questionId. May be partial.',
  })
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => SubmitSelfEvaluationItemDto)
  items: SubmitSelfEvaluationItemDto[];
}

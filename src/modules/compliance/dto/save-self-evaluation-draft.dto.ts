import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { SubmitSelfEvaluationItemDto } from './submit-self-evaluation.dto';

export class SaveSelfEvaluationDraftDto {
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

  @ApiProperty({
    type: [SubmitSelfEvaluationItemDto],
    description:
      'Authoritative current Yes/No answers. May be partial. Items omitted from this list are removed from the draft.',
  })
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => SubmitSelfEvaluationItemDto)
  items: SubmitSelfEvaluationItemDto[];

  @ApiPropertyOptional({
    example: '9f3e2c1a-1111-2222-3333-444444444444',
    description: 'Stable client-side draft id used to match localStorage to this assessment',
  })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  clientDraftId?: string;
}

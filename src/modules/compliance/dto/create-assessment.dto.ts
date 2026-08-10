import { ApiProperty } from '@nestjs/swagger';
import { AssessmentType } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsString,
  IsUUID,
} from 'class-validator';

export class CreateAssessmentDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  centerId: string;

  @ApiProperty({ example: '2024.1' })
  @IsString()
  @IsNotEmpty()
  standardsVersion: string;

  @ApiProperty({ enum: AssessmentType, enumName: 'AssessmentType' })
  @IsEnum(AssessmentType)
  assessmentType: AssessmentType;

  @ApiProperty({
    example: '2026-08-06',
    description: 'Assessment date (ISO date string)',
  })
  @IsDateString()
  assessmentDate: string;
}

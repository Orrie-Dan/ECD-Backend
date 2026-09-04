import { AssessmentStatus } from '../../../common/domain';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional, Min } from 'class-validator';

export class UpdateAssessmentDto {
  @ApiProperty({
    example: 1,
    minimum: 1,
    description: 'Required for optimistic locking (CAS)',
  })
  @IsInt()
  @Min(1)
  version: number;

  @ApiPropertyOptional({
    enum: AssessmentStatus,
    enumName: 'AssessmentStatus',
  })
  @IsOptional()
  @IsEnum(AssessmentStatus)
  status?: AssessmentStatus;
}

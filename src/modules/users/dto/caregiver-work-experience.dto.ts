import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

/**
 * Nested / standalone work-experience payload (SF-13).
 * Persisted as CaregiverWorkExperience linked via userId.
 */
export class CreateCaregiverWorkExperienceDto {
  @ApiProperty({ example: 'NCDA', minLength: 1, maxLength: 300 })
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  employer: string;

  @ApiProperty({ example: 'Caregiver', minLength: 1, maxLength: 200 })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  jobTitle: string;

  @ApiProperty({ example: '2020-01-15', description: 'Employment start date' })
  @IsDateString()
  startDate: string;

  @ApiPropertyOptional({
    example: '2024-06-30',
    nullable: true,
    description: 'Employment end date. Omit or null when still current.',
  })
  @IsOptional()
  @ValidateIf((_, v) => v != null && v !== '')
  @IsDateString()
  endDate?: string | null;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;
}

export class UpdateCaregiverWorkExperienceDto {
  @ApiProperty({ example: 1, minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version: number;

  @ApiPropertyOptional({ maxLength: 300 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  employer?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  jobTitle?: string;

  @ApiPropertyOptional({ example: '2020-01-15' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ example: '2024-06-30', nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v != null && v !== '')
  @IsDateString()
  endDate?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null;
}

export class CaregiverWorkExperienceResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  userId: string;

  @ApiProperty()
  employer: string;

  @ApiProperty()
  jobTitle: string;

  @ApiProperty({ type: String, format: 'date-time' })
  startDate: Date;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  endDate: Date | null;

  @ApiProperty({ nullable: true })
  description: string | null;

  @ApiProperty({ format: 'uuid' })
  recordedById: string;

  @ApiProperty()
  version: number;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt: Date;
}

export class CaregiverWorkExperienceListResponseDto {
  @ApiProperty({ type: [CaregiverWorkExperienceResponseDto] })
  items: CaregiverWorkExperienceResponseDto[];
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * Nested training payload when registering a caregiver (SF-12).
 * Persisted as StaffTraining linked via traineeUserId — reuses the existing
 * training domain rather than denormalizing onto UserAccount.
 */
export class CreateCaregiverTrainingDto {
  @ApiProperty({
    example: '2026-02-10',
    description: 'Training start date. Duration is stored as durationDays.',
  })
  @IsDateString()
  trainingDate: string;

  @ApiProperty({ example: 'NCDA / District', minLength: 1, maxLength: 300 })
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  trainingProvider: string;

  @ApiProperty({ example: 'Early stimulation', minLength: 1, maxLength: 300 })
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  topic: string;

  @ApiProperty({ example: 3, minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  durationDays: number;

  @ApiProperty({ example: true })
  @IsBoolean()
  certificateReceived: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

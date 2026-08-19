import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ApiChildGender } from './child-response.dto';

const API_GENDERS: ApiChildGender[] = ['Umuhungu', 'Umukobwa'];

export class UpdateChildDto {
  /** Expected optimistic-lock version from the last read. */
  @ApiProperty({
    example: 1,
    minimum: 0,
    description: 'Expected optimistic-lock version from the last read',
  })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  version: number;

  @ApiPropertyOptional({ example: 'Uwimana Jean', maxLength: 200 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  fullName?: string;

  @ApiPropertyOptional({ example: 'Jean', maxLength: 100 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstName?: string;

  @ApiPropertyOptional({ example: 'Pierre', maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  middleName?: string;

  @ApiPropertyOptional({ example: 'Uwimana', maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  lastName?: string;

  @ApiPropertyOptional({ example: '2020-05-15', description: 'ISO-8601 date of birth' })
  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;

  @ApiPropertyOptional({
    enum: ['Umuhungu', 'Umukobwa'],
    enumName: 'ApiChildGender',
    example: 'Umukobwa',
  })
  @IsOptional()
  @IsIn(API_GENDERS)
  gender?: ApiChildGender;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'ECD center UUID',
  })
  @IsOptional()
  @IsUUID()
  centerId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Home village admin-unit UUID',
  })
  @IsOptional()
  @IsUUID()
  homeVillageId?: string;

  @ApiPropertyOptional({ example: 'Mukamana Alice', maxLength: 150 })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  guardianName?: string;

  @ApiPropertyOptional({ example: '+250788123456', maxLength: 50 })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  guardianPhone?: string;

  @ApiPropertyOptional({ example: 'Mother', maxLength: 50 })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  guardianRelation?: string;

  @ApiPropertyOptional({ example: 'Niyonsenga Paul', maxLength: 150 })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  guardian2Name?: string;

  @ApiPropertyOptional({ example: '+250788654321', maxLength: 50 })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  guardian2Phone?: string;

  @ApiPropertyOptional({ example: 'Father', maxLength: 50 })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  guardian2Relation?: string;

  @ApiPropertyOptional({
    description: 'Special needs or accommodations',
    example: 'Hearing impairment',
  })
  @IsOptional()
  @IsString()
  specialNeeds?: string;

  @ApiPropertyOptional({ example: 'Prefers morning sessions' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({
    description: 'Reason for archiving the child record',
    example: 'Moved out of catchment',
  })
  @IsOptional()
  @IsString()
  archiveReason?: string;

  @ApiPropertyOptional({
    example: '2024-06-01T00:00:00.000Z',
    description: 'Archive timestamp (ISO-8601)',
  })
  @IsOptional()
  @IsDateString()
  archivedAt?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Classroom UUID for grade reassignment',
  })
  @IsOptional()
  @IsUUID()
  classroomId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Originating device UUID for offline sync',
  })
  @IsOptional()
  @IsUUID()
  deviceId?: string;
}

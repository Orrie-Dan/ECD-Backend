import {
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ApiChildGender } from './child-response.dto';

const API_GENDERS: ApiChildGender[] = ['Umuhungu', 'Umukobwa'];

export class CreateChildDto {
  @ApiProperty({
    description: 'Full name; required when firstName is omitted',
    example: 'Uwimana Jean',
    maxLength: 200,
    required: false,
  })
  @ValidateIf((o: CreateChildDto) => !o.firstName)
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(200)
  fullName?: string;

  @ApiProperty({
    description: 'Given name; required when fullName is omitted',
    example: 'Jean',
    maxLength: 100,
    required: false,
  })
  @ValidateIf((o: CreateChildDto) => !o.fullName)
  @IsString()
  @IsNotEmpty()
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

  @ApiProperty({ example: '2020-05-15', description: 'ISO-8601 date of birth' })
  @IsDateString()
  dateOfBirth: string;

  @ApiProperty({
    enum: ['Umuhungu', 'Umukobwa'],
    enumName: 'ApiChildGender',
    example: 'Umuhungu',
  })
  @IsIn(API_GENDERS)
  gender: ApiChildGender;

  @ApiProperty({
    format: 'uuid',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    description: 'ECD center UUID',
  })
  @IsUUID()
  centerId: string;

  @ApiProperty({ example: 'REG-2024-001', maxLength: 50 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  registrationNumber: string;

  @ApiProperty({
    format: 'uuid',
    example: 'b2c3d4e5-f6a7-8901-bcde-f12345678901',
    description: 'Home village admin-unit UUID',
  })
  @IsUUID()
  homeVillageId: string;

  @ApiProperty({ example: 'Mukamana Alice', maxLength: 150 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  guardianName: string;

  @ApiProperty({ example: '+250788123456', maxLength: 50 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  guardianPhone: string;

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
    example: '2024-01-10',
    description: 'Registration date (ISO-8601); defaults to now if omitted',
  })
  @IsOptional()
  @IsDateString()
  registeredAt?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Originating device UUID for offline sync',
  })
  @IsOptional()
  @IsUUID()
  deviceId?: string;
}

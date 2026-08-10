import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

export class CreateWashIndicatorDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  centerId: string;

  @ApiProperty({
    example: '2026-08-06',
    description: 'Date the indicator was recorded (ISO date string)',
  })
  @IsDateString()
  recordedDate: string;

  @ApiProperty({ example: true })
  @IsBoolean()
  waterSourceAvailable: boolean;

  @ApiPropertyOptional({ example: 'piped' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  waterSourceType?: string;

  @ApiProperty({ example: true })
  @IsBoolean()
  sanitationFacilityAvailable: boolean;

  @ApiPropertyOptional({ example: 2, minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  latrineCount?: number;

  @ApiProperty({ example: true })
  @IsBoolean()
  handwashingFacilityAvailable: boolean;

  @ApiProperty({ example: true })
  @IsBoolean()
  wasteManagementAvailable: boolean;

  @ApiPropertyOptional({ example: 'Notes' })
  @IsOptional()
  @IsString()
  notes?: string;
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';

export class UpdateWashIndicatorDto {
  @ApiProperty({
    example: 1,
    minimum: 1,
    description: 'Required for optimistic locking (CAS)',
  })
  @IsInt()
  @Min(1)
  version: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  waterSourceAvailable?: boolean;

  @ApiPropertyOptional({ example: 'piped' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  waterSourceType?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  sanitationFacilityAvailable?: boolean;

  @ApiPropertyOptional({ example: 2, minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  latrineCount?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  handwashingFacilityAvailable?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  wasteManagementAvailable?: boolean;

  @ApiPropertyOptional({ example: 'Notes' })
  @IsOptional()
  @IsString()
  notes?: string;
}

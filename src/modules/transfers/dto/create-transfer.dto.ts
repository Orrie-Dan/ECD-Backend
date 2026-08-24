import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateTransferDto {
  @ApiProperty({ format: 'uuid', example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  @IsUUID()
  childId: string;

  @ApiProperty({ format: 'uuid', description: 'Destination ECD center ID' })
  @IsUUID()
  toCenterId: string;

  @ApiProperty({
    type: String,
    format: 'date',
    example: '2026-08-06',
    description: 'ISO-8601 date of the transfer',
  })
  @IsDateString()
  transferDate: string;

  @ApiProperty({ example: 'Family relocated', minLength: 1, maxLength: 255 })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  reason: string;

  @ApiPropertyOptional({ description: 'Optional free-text notes' })
  @IsOptional()
  @IsString()
  notes?: string;

  /** Expected child optimistic-lock version from the last read. */
  @ApiProperty({
    description: 'Expected child optimistic-lock version from the last read (required for CAS)',
    example: 1,
    minimum: 0,
  })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  childVersion: number;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Optional client device ID for audit trail (also accepted via x-device-id header)',
  })
  @IsOptional()
  @IsUUID()
  deviceId?: string;
}

import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ArchiveChildDto {
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

  @ApiPropertyOptional({
    example: 'Moved out of catchment',
    maxLength: 500,
    description: 'Reason for archiving',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  archiveReason?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Originating device UUID for offline sync',
  })
  @IsOptional()
  @IsUUID()
  deviceId?: string;
}

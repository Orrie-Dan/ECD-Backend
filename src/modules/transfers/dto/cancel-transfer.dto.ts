import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Min } from 'class-validator';

export class CancelTransferDto {
  /** Expected transfer optimistic-lock version from the last read. */
  @ApiProperty({
    description:
      'Expected transfer optimistic-lock version from the last read (required for CAS)',
    example: 1,
    minimum: 0,
  })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  version: number;

  /** Expected child optimistic-lock version from the last read. */
  @ApiProperty({
    description:
      'Expected child optimistic-lock version from the last read (required for CAS)',
    example: 1,
    minimum: 0,
  })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  childVersion: number;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Optional client device ID for audit trail (also accepted via x-device-id header)',
  })
  @IsOptional()
  @IsUUID()
  deviceId?: string;
}

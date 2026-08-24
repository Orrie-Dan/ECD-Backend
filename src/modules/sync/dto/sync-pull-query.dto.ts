import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { SYNC_PULL_DEFAULT_LIMIT, SYNC_PULL_MAX_LIMIT } from '../sync.constants';

export class SyncPullQueryDto {
  /**
   * Keyset watermark (ISO datetime). Prefer sending with `cursorId` so records
   * that share the same `lastModifiedAt` are not skipped.
   * Legacy clients may send only this field (strict `lastModifiedAt > cursor`).
   */
  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    description:
      'Keyset watermark. Prefer with cursorId so same-timestamp records are not skipped. Legacy: lastModifiedAt > cursor only',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  cursor?: Date;

  /**
   * Tie-breaker for keyset pagination. Required with `cursor` for correct
   * resume after pages that end mid-timestamp.
   */
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Tie-breaker for keyset pagination; use with cursor to resume mid-timestamp pages',
  })
  @IsOptional()
  @IsUUID()
  cursorId?: string;

  @ApiPropertyOptional({
    example: SYNC_PULL_DEFAULT_LIMIT,
    minimum: 1,
    maximum: SYNC_PULL_MAX_LIMIT,
    default: SYNC_PULL_DEFAULT_LIMIT,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(SYNC_PULL_MAX_LIMIT)
  limit?: number = SYNC_PULL_DEFAULT_LIMIT;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Optional device id for sync attribution',
  })
  @IsOptional()
  @IsUUID()
  deviceId?: string;
}

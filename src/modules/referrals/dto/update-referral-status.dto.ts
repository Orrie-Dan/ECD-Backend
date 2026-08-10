import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiReferralStatus } from './referral-response.dto';

/** Terminal statuses only — pending is the initial state, not a PATCH target. */
const API_STATUS_TRANSITIONS: ApiReferralStatus[] = ['completed', 'cancelled'];

export class UpdateReferralStatusDto {
  /** Expected optimistic-lock version from the last read. */
  @ApiProperty({
    description:
      'Expected optimistic-lock version from the last read (required for CAS)',
    example: 1,
    minimum: 0,
  })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  version: number;

  @ApiProperty({
    enum: API_STATUS_TRANSITIONS,
    enumName: 'ApiReferralUpdateStatus',
    description:
      'Terminal statuses only — pending is the initial state, not a PATCH target',
    example: 'completed',
  })
  @IsIn(API_STATUS_TRANSITIONS)
  status: 'completed' | 'cancelled';

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    description: 'When the referral was implemented (typically for completed)',
  })
  @IsOptional()
  @IsDateString()
  implementedAt?: string;

  @ApiPropertyOptional({ maxLength: 5000 })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Optional client device ID for audit trail (also accepted via x-device-id header)',
  })
  @IsOptional()
  @IsUUID()
  deviceId?: string;
}

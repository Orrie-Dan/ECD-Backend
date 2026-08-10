import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import {
  ApiReferralSourceType,
  ApiReferralStatus,
} from './referral-response.dto';

const API_STATUSES: ApiReferralStatus[] = [
  'pending',
  'completed',
  'cancelled',
];
const API_SOURCE_TYPES: ApiReferralSourceType[] = ['nutrition', 'sted'];

export class ListReferralsQueryDto {
  @ApiPropertyOptional({ example: 1, minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ example: 50, minimum: 1, maximum: 200, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number = 50;

  @ApiPropertyOptional({
    enum: API_STATUSES,
    enumName: 'ApiReferralStatus',
  })
  @IsOptional()
  @IsIn(API_STATUSES)
  status?: ApiReferralStatus;

  @ApiPropertyOptional({
    enum: API_SOURCE_TYPES,
    enumName: 'ApiReferralSourceType',
  })
  @IsOptional()
  @IsIn(API_SOURCE_TYPES)
  sourceType?: ApiReferralSourceType;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  centerId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  childId?: string;
}

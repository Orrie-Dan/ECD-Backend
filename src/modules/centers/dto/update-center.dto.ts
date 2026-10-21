import { EcdCenterStatus, EcdFacilityType } from '../../../common/domain';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { MIN_START_YEAR, NCDA_TYPE_CODES, NcdaTypeCode } from '../ecd-code';

export class UpdateCenterDto {
  /** Required for optimistic locking (CAS). */
  @ApiProperty({
    example: 1,
    minimum: 1,
    description: 'Required for optimistic locking (CAS)',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version: number;

  @ApiPropertyOptional({ example: 'Kigali ECD Center', minLength: 1, maxLength: 200 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional({
    example: '+250788123456',
    maxLength: 30,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string | null;

  @ApiPropertyOptional({ example: 40, minimum: 0, nullable: true })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  capacity?: number | null;

  @ApiPropertyOptional({ example: -1.9441, nullable: true })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  latitude?: number | null;

  @ApiPropertyOptional({ example: 30.0619, nullable: true })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  longitude?: number | null;

  @ApiPropertyOptional({
    enum: EcdCenterStatus,
    enumName: 'EcdCenterStatus',
  })
  @IsOptional()
  @IsEnum(EcdCenterStatus)
  status?: EcdCenterStatus;

  /**
   * Canonical ECD facility type. Null clears classification.
   * Allowed: daycare | home_based | community_based | ecd_3_5
   */
  @ApiPropertyOptional({
    enum: EcdFacilityType,
    enumName: 'EcdFacilityType',
    nullable: true,
    description: 'Canonical facility type (null clears)',
  })
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsEnum(EcdFacilityType)
  facilityType?: EcdFacilityType | null;

  /** NCDA type letter; also sets facilityType. Does not change the issued code. */
  @ApiPropertyOptional({
    enum: NCDA_TYPE_CODES,
    description: 'NCDA type letter (A–E). Sets facilityType; the issued code is never changed.',
  })
  @IsOptional()
  @IsIn(NCDA_TYPE_CODES as unknown as string[])
  ncdaTypeCode?: NcdaTypeCode;

  @ApiPropertyOptional({
    example: 2020,
    minimum: MIN_START_YEAR,
    description: 'Year the facility started providing services. The issued code is never changed.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(MIN_START_YEAR)
  @Max(2100)
  startYear?: number;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  villageId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Optional device id for offline sync attribution',
  })
  @IsOptional()
  @IsUUID()
  deviceId?: string;
}

import { EcdCenterStatus } from '../../../common/domain';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

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

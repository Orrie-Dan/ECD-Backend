import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CenterSupportCategory } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsDateString,
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

export class CreateCenterSupportDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  centerId: string;

  @ApiProperty({ example: '2026-04-02' })
  @IsDateString()
  receivedDate: string;

  @ApiProperty({
    enum: CenterSupportCategory,
    enumName: 'CenterSupportCategory',
  })
  @IsEnum(CenterSupportCategory)
  supportCategory: CenterSupportCategory;

  @ApiProperty({ example: 'Maize flour donation', minLength: 1, maxLength: 500 })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  description: string;

  @ApiPropertyOptional({ example: 50, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  quantity?: number;

  @ApiPropertyOptional({ example: 'kg', maxLength: 50 })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  unit?: string;

  @ApiProperty({ example: 'Sector agronomist', minLength: 1, maxLength: 200 })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  providerName: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  providerOrganization?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  receivedById?: string;

  @ApiPropertyOptional({
    maxLength: 200,
    description: 'Receiver name when the receiver is not a platform user',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  receivedByName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateCenterSupportDto {
  @ApiProperty({ example: 1, minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version: number;

  @ApiPropertyOptional({
    enum: CenterSupportCategory,
    enumName: 'CenterSupportCategory',
  })
  @IsOptional()
  @IsEnum(CenterSupportCategory)
  supportCategory?: CenterSupportCategory;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ minimum: 0, nullable: true })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  quantity?: number | null;

  @ApiPropertyOptional({ maxLength: 50, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  unit?: string | null;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  providerName?: string;

  @ApiPropertyOptional({ maxLength: 200, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  providerOrganization?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  notes?: string | null;
}

export class CenterSupportResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  centerId: string;

  @ApiProperty()
  centerName: string;

  @ApiProperty({ format: 'uuid' })
  districtId: string;

  @ApiProperty({ type: String, format: 'date-time' })
  receivedDate: Date;

  @ApiProperty({
    enum: CenterSupportCategory,
    enumName: 'CenterSupportCategory',
  })
  supportCategory: CenterSupportCategory;

  @ApiProperty()
  description: string;

  @ApiProperty({ nullable: true })
  quantity: number | null;

  @ApiProperty({ nullable: true })
  unit: string | null;

  @ApiProperty()
  providerName: string;

  @ApiProperty({ nullable: true })
  providerOrganization: string | null;

  @ApiProperty({ format: 'uuid', nullable: true })
  receivedById: string | null;

  @ApiProperty({ nullable: true })
  receivedByName: string | null;

  @ApiProperty({ nullable: true })
  notes: string | null;

  @ApiProperty({ format: 'uuid' })
  recordedById: string;

  @ApiProperty()
  version: number;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt: Date;
}

export class PaginatedCenterSupportResponseDto {
  @ApiProperty({ type: [CenterSupportResponseDto] })
  items: CenterSupportResponseDto[];

  @ApiProperty()
  total: number;

  @ApiProperty()
  page: number;

  @ApiProperty()
  pageSize: number;

  @ApiProperty()
  totalPages: number;
}

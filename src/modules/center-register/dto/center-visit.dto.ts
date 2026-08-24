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

export class CreateCenterVisitDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  centerId: string;

  @ApiProperty({ example: '2026-05-20' })
  @IsDateString()
  visitDate: string;

  @ApiProperty({ example: 'Kalisa Patrick', minLength: 1, maxLength: 200 })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  visitorName: string;

  @ApiPropertyOptional({ example: 'NCDA', maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  organization?: string;

  @ApiPropertyOptional({ example: 'District education officer', maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  occupationOrRole?: string;

  @ApiProperty({ minLength: 1 })
  @IsString()
  @MinLength(1)
  purposeOrMessage: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  hostedById?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateCenterVisitDto {
  @ApiProperty({ example: 1, minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version: number;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  visitorName?: string;

  @ApiPropertyOptional({ maxLength: 200, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  organization?: string | null;

  @ApiPropertyOptional({ maxLength: 200, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  occupationOrRole?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  purposeOrMessage?: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID()
  hostedById?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  notes?: string | null;
}

export class CenterVisitResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  centerId: string;

  @ApiProperty()
  centerName: string;

  @ApiProperty({ format: 'uuid' })
  districtId: string;

  @ApiProperty({ type: String, format: 'date-time' })
  visitDate: Date;

  @ApiProperty()
  visitorName: string;

  @ApiProperty({ nullable: true })
  organization: string | null;

  @ApiProperty({ nullable: true })
  occupationOrRole: string | null;

  @ApiProperty()
  purposeOrMessage: string;

  @ApiProperty({ format: 'uuid', nullable: true })
  hostedById: string | null;

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

export class PaginatedCenterVisitsResponseDto {
  @ApiProperty({ type: [CenterVisitResponseDto] })
  items: CenterVisitResponseDto[];

  @ApiProperty()
  total: number;

  @ApiProperty()
  page: number;

  @ApiProperty()
  pageSize: number;

  @ApiProperty()
  totalPages: number;
}

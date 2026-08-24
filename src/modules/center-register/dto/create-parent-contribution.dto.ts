import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { InKindItemType, ParentContributionType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateParentContributionDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  centerId: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Optional child when the contributor is recorded against an enrolled child. Guardians are not a separate person table.',
  })
  @IsOptional()
  @IsUUID()
  childId?: string;

  @ApiProperty({ example: 'Mukamana Alice', minLength: 1, maxLength: 200 })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  contributorName: string;

  @ApiPropertyOptional({ example: '+250788123456', maxLength: 50 })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  contributorPhone?: string;

  @ApiProperty({ example: '2026-03-15' })
  @IsDateString()
  contributionDate: string;

  @ApiProperty({
    enum: ParentContributionType,
    enumName: 'ParentContributionType',
  })
  @IsEnum(ParentContributionType)
  contributionType: ParentContributionType;

  @ApiPropertyOptional({
    example: 5000,
    minimum: 0,
    description: 'Required for cash contributions; must be omitted for in-kind',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  amount?: number;

  @ApiPropertyOptional({
    enum: InKindItemType,
    enumName: 'InKindItemType',
    description: 'Required for in-kind contributions',
  })
  @IsOptional()
  @IsEnum(InKindItemType)
  itemType?: InKindItemType;

  @ApiPropertyOptional({ example: 10, minimum: 0 })
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

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

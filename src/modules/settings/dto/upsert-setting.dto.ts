import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsUUID } from 'class-validator';

export class UpsertSettingDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  districtId: string;

  @ApiProperty({ example: 'attendance.cutoff_time' })
  @IsString()
  @IsNotEmpty()
  key: string;

  @ApiProperty({ example: '16:00' })
  @IsString()
  @IsNotEmpty()
  value: string;
}

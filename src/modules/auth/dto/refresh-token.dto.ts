import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class RefreshTokenDto {
  @ApiProperty({
    description: 'Refresh token previously issued by login or refresh',
  })
  @IsString()
  @IsNotEmpty()
  refreshToken: string;
}

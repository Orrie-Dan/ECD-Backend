import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'caregiver01', description: 'Account username' })
  @IsString()
  @IsNotEmpty()
  username: string;

  @ApiProperty({
    example: 'secret123',
    minLength: 6,
    description: 'Account password',
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  password: string;
}

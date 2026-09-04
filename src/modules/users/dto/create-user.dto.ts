import { EducationLevel, PersonSex, UserRole } from '../../../common/domain';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class CreateUserDto {
  @ApiProperty({
    example: 'caregiver01',
    minLength: 3,
    maxLength: 100,
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(100)
  username: string;

  @ApiProperty({
    example: 'Jane Doe',
    minLength: 1,
    maxLength: 200,
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(200)
  fullName: string;

  @ApiProperty({ enum: UserRole, enumName: 'UserRole' })
  @IsEnum(UserRole)
  role: UserRole;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Required when role is district_focal_person',
  })
  @ValidateIf((o: CreateUserDto) => o.role === UserRole.district_focal_person)
  @IsUUID()
  districtId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Required when role is caregiver or ecd_director',
  })
  @ValidateIf(
    (o: CreateUserDto) => o.role === UserRole.caregiver || o.role === UserRole.ecd_director,
  )
  @IsUUID()
  centerId?: string;

  @ApiPropertyOptional({ example: '+250788123456', maxLength: 50 })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;

  @ApiPropertyOptional({
    enum: PersonSex,
    enumName: 'PersonSex',
    description: 'Sex of the staff member (Section XI). Optional for all roles.',
  })
  @IsOptional()
  @IsEnum(PersonSex)
  gender?: PersonSex;

  @ApiPropertyOptional({
    enum: EducationLevel,
    enumName: 'EducationLevel',
    description: 'Education level for centre caregivers/educators (Section XI).',
  })
  @IsOptional()
  @IsEnum(EducationLevel)
  educationLevel?: EducationLevel;
}

import { EducationLevel, PersonSex, UserRole } from '../../../common/domain';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { CreateCaregiverTrainingDto } from './create-caregiver-training.dto';
import { CreateCaregiverWorkExperienceDto } from './caregiver-work-experience.dto';

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
    description:
      'Required when role is sector_focal_person. Must be an AdministrativeUnit with level=sector. districtId is derived from the sector.',
  })
  @ValidateIf((o: CreateUserDto) => o.role === UserRole.sector_focal_person)
  @IsUUID()
  sectorId?: string;

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
    example: 'caregiver01@example.com',
    maxLength: 254,
    description: 'Optional account email for password reset and transactional mail',
  })
  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string;

  @ApiPropertyOptional({
    enum: PersonSex,
    enumName: 'PersonSex',
    description:
      'Sex of the staff member (Section XI). Required when role is caregiver or ecd_director.',
  })
  @ValidateIf(
    (o: CreateUserDto) =>
      o.role === UserRole.caregiver || o.role === UserRole.ecd_director || o.gender != null,
  )
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

  @ApiPropertyOptional({
    type: [CreateCaregiverTrainingDto],
    description:
      'Optional trainings already received (Amahugurwa yabonye). Only allowed when role is caregiver. ' +
      'Created as StaffTraining rows linked to the new user — zero trainings is valid.',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateCaregiverTrainingDto)
  trainings?: CreateCaregiverTrainingDto[];

  @ApiPropertyOptional({
    type: [CreateCaregiverWorkExperienceDto],
    description:
      'Optional CV work experiences (Ubunararibonye). Only allowed when role is caregiver. ' +
      'Created as CaregiverWorkExperience rows linked to the new user — zero entries is valid.',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateCaregiverWorkExperienceDto)
  workExperiences?: CreateCaregiverWorkExperienceDto[];
}

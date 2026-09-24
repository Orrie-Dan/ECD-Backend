import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import {
  ApiNotFoundError,
  ApiOptimisticLockConflict,
  ApiStandardClientErrors,
} from '../../common/swagger';
import { UserRole } from '../../common/domain';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuthUser } from '../auth/interfaces/jwt-payload.interface';
import { CaregiverWorkExperiencesService } from './caregiver-work-experiences.service';
import {
  CaregiverWorkExperienceListResponseDto,
  CaregiverWorkExperienceResponseDto,
  CreateCaregiverWorkExperienceDto,
  UpdateCaregiverWorkExperienceDto,
} from './dto/caregiver-work-experience.dto';

@ApiTags('caregiver-work-experiences')
@ApiBearerAuth()
@Controller('users/:userId/work-experiences')
@Roles(UserRole.ecd_director, UserRole.district_focal_person, UserRole.sector_focal_person, UserRole.ncda_admin)
export class CaregiverWorkExperiencesController {
  constructor(private readonly service: CaregiverWorkExperiencesService) {}

  @Get()
  @ApiOperation({
    summary: 'List caregiver work experiences',
    description:
      'Returns CV-style work history for a caregiver visible in the caller management scope (SF-13).',
  })
  @ApiParam({ name: 'userId', format: 'uuid' })
  @ApiOkResponse({ type: CaregiverWorkExperienceListResponseDto })
  @ApiStandardClientErrors()
  @ApiNotFoundError('User')
  list(@CurrentUser() user: AuthUser, @Param('userId', ParseUUIDPipe) userId: string) {
    return this.service.listForUser(user, userId);
  }

  @Post()
  @ApiOperation({
    summary: 'Add caregiver work experience',
    description: 'Creates a work-experience entry for the target caregiver (SF-13).',
  })
  @ApiParam({ name: 'userId', format: 'uuid' })
  @ApiCreatedResponse({ type: CaregiverWorkExperienceResponseDto })
  @ApiStandardClientErrors()
  @ApiNotFoundError('User')
  create(
    @CurrentUser() user: AuthUser,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: CreateCaregiverWorkExperienceDto,
  ) {
    return this.service.createForUser(user, userId, dto);
  }

  @Patch(':experienceId')
  @ApiOperation({
    summary: 'Update caregiver work experience',
    description: 'Optimistic-lock update of a work-experience entry (SF-13).',
  })
  @ApiParam({ name: 'userId', format: 'uuid' })
  @ApiParam({ name: 'experienceId', format: 'uuid' })
  @ApiOkResponse({ type: CaregiverWorkExperienceResponseDto })
  @ApiOptimisticLockConflict()
  @ApiStandardClientErrors()
  @ApiNotFoundError('Work experience')
  update(
    @CurrentUser() user: AuthUser,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('experienceId', ParseUUIDPipe) experienceId: string,
    @Body() dto: UpdateCaregiverWorkExperienceDto,
  ) {
    return this.service.update(user, userId, experienceId, dto);
  }
}

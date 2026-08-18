import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import {
  ApiAuthErrors,
  ApiNotFoundError,
  ApiOptimisticLockConflict,
  ApiStandardClientErrors,
} from '../../common/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuthUser } from '../auth/interfaces/jwt-payload.interface';
import { ComplianceService } from './compliance.service';
import { CreateAssessmentDto } from './dto/create-assessment.dto';
import { CreateAssessmentItemDto } from './dto/create-assessment-item.dto';
import {
  AssessmentDetailResponseDto,
  AssessmentItemResponseDto,
  AssessmentResponseDto,
  PaginatedAssessmentsResponseDto,
  StandardResponseDto,
} from './dto/compliance-response.dto';
import { ListAssessmentsQueryDto } from './dto/list-assessments-query.dto';
import { UpdateAssessmentDto } from './dto/update-assessment.dto';
import { UpdateAssessmentItemDto } from './dto/update-assessment-item.dto';

@ApiTags('compliance')
@ApiBearerAuth()
@Controller('compliance')
export class ComplianceController {
  constructor(private readonly complianceService: ComplianceService) {}

  @Get('assessments')
  @Roles(
    UserRole.caregiver,
    UserRole.ecd_director,
    UserRole.district_focal_person,
    UserRole.ncda_admin,
  )
  @ApiOperation({
    summary: 'List compliance assessments',
    description: 'Paginated assessments filtered by center/district/status/date.',
  })
  @ApiOkResponse({ type: PaginatedAssessmentsResponseDto })
  @ApiStandardClientErrors()
  listAssessments(
    @CurrentUser() user: AuthUser,
    @Query() query: ListAssessmentsQueryDto,
  ) {
    return this.complianceService.listAssessments(user, query);
  }

  @Get('assessments/:id')
  @Roles(
    UserRole.caregiver,
    UserRole.ecd_director,
    UserRole.district_focal_person,
    UserRole.ncda_admin,
  )
  @ApiOperation({
    summary: 'Get assessment detail',
    description: 'Returns an assessment including scored items.',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Assessment UUID' })
  @ApiOkResponse({ type: AssessmentDetailResponseDto })
  @ApiAuthErrors()
  @ApiNotFoundError('Assessment')
  getAssessment(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.complianceService.getAssessment(user, id);
  }

  @Post('assessments')
  @Roles(UserRole.district_focal_person, UserRole.ncda_admin)
  @ApiOperation({
    summary: 'Create compliance assessment',
    description: 'Creates a new center compliance assessment draft/submission.',
  })
  @ApiCreatedResponse({ type: AssessmentResponseDto })
  @ApiStandardClientErrors()
  @ApiNotFoundError('Center')
  createAssessment(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateAssessmentDto,
  ) {
    return this.complianceService.createAssessment(user, dto);
  }

  @Patch('assessments/:id')
  @Roles(UserRole.district_focal_person, UserRole.ncda_admin)
  @ApiOperation({
    summary: 'Update compliance assessment',
    description:
      'Updates assessment metadata/status. Requires optimistic-lock `version`.',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Assessment UUID' })
  @ApiOkResponse({ type: AssessmentResponseDto })
  @ApiStandardClientErrors()
  @ApiNotFoundError('Assessment')
  @ApiOptimisticLockConflict()
  updateAssessment(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAssessmentDto,
  ) {
    return this.complianceService.updateAssessment(user, id, dto);
  }

  @Get('standards')
  @Roles(
    UserRole.caregiver,
    UserRole.ecd_director,
    UserRole.district_focal_person,
    UserRole.ncda_admin,
  )
  @ApiOperation({
    summary: 'List compliance standards',
    description: 'Returns the active compliance standard catalogue.',
  })
  @ApiOkResponse({ type: [StandardResponseDto] })
  @ApiAuthErrors()
  listStandards() {
    return this.complianceService.listStandards();
  }

  @Post('assessments/:id/items')
  @Roles(UserRole.district_focal_person, UserRole.ncda_admin)
  @ApiOperation({
    summary: 'Add assessment item',
    description: 'Creates a scored item (standard response) on an assessment.',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Assessment UUID' })
  @ApiCreatedResponse({ type: AssessmentItemResponseDto })
  @ApiStandardClientErrors()
  @ApiNotFoundError('Assessment')
  createAssessmentItem(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) assessmentId: string,
    @Body() dto: CreateAssessmentItemDto,
  ) {
    return this.complianceService.createAssessmentItem(user, assessmentId, dto);
  }

  @Patch('assessments/:id/items/:itemId')
  @Roles(UserRole.district_focal_person, UserRole.ncda_admin)
  @ApiOperation({
    summary: 'Update assessment item',
    description:
      'Updates an assessment item (response, gaps). Requires optimistic-lock `version`.',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Assessment UUID' })
  @ApiParam({ name: 'itemId', format: 'uuid', description: 'Assessment item UUID' })
  @ApiOkResponse({ type: AssessmentItemResponseDto })
  @ApiStandardClientErrors()
  @ApiNotFoundError('Assessment item')
  @ApiOptimisticLockConflict()
  updateAssessmentItem(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) assessmentId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: UpdateAssessmentItemDto,
  ) {
    return this.complianceService.updateAssessmentItem(
      user,
      assessmentId,
      itemId,
      dto,
    );
  }
}

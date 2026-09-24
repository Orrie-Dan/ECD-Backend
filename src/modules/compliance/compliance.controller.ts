import { UserRole } from '../../common/domain';
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
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
import { CreateInspectionDto } from './dto/create-inspection.dto';
import {
  AssessmentDetailResponseDto,
  AssessmentItemResponseDto,
  AssessmentResponseDto,
  PaginatedAssessmentsResponseDto,
  SelfEvalDraftEnvelopeDto,
  StandardResponseDto,
} from './dto/compliance-response.dto';
import { ListAssessmentsQueryDto } from './dto/list-assessments-query.dto';
import { SaveInspectionDraftDto } from './dto/save-inspection-draft.dto';
import { SaveSelfEvaluationDraftDto } from './dto/save-self-evaluation-draft.dto';
import { SubmitInspectionDto } from './dto/submit-inspection.dto';
import { SubmitSelfEvaluationDto } from './dto/submit-self-evaluation.dto';
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
    UserRole.sector_focal_person,
    UserRole.ncda_admin,
  )
  @ApiOperation({
    summary: 'List compliance assessments',
    description:
      'Paginated assessments filtered by center/district/assessmentType/status/date.',
  })
  @ApiOkResponse({ type: PaginatedAssessmentsResponseDto })
  @ApiStandardClientErrors()
  listAssessments(@CurrentUser() user: AuthUser, @Query() query: ListAssessmentsQueryDto) {
    return this.complianceService.listAssessments(user, query);
  }

  @Get('self-evaluations/draft')
  @Roles(UserRole.ecd_director)
  @ApiOperation({
    summary: 'Get current ECD Standards self-evaluation draft',
    description: "Returns the authenticated ECD director's active draft for their center, if any.",
  })
  @ApiOkResponse({ type: SelfEvalDraftEnvelopeDto })
  @ApiStandardClientErrors()
  getSelfEvalDraft(@CurrentUser() user: AuthUser) {
    return this.complianceService.getSelfEvalDraft(user);
  }

  @Put('self-evaluations/draft')
  @Roles(UserRole.ecd_director)
  @ApiOperation({
    summary: 'Create or update ECD Standards self-evaluation draft',
    description:
      "Upserts the center's single active self-evaluation draft. Partial answers are allowed. Submitted assessments are not modified.",
  })
  @ApiOkResponse({ type: AssessmentDetailResponseDto })
  @ApiStandardClientErrors()
  @ApiNotFoundError('Center')
  saveSelfEvalDraft(@CurrentUser() user: AuthUser, @Body() dto: SaveSelfEvaluationDraftDto) {
    return this.complianceService.saveSelfEvalDraft(user, dto);
  }

  @Delete('self-evaluations/draft')
  @Roles(UserRole.ecd_director)
  @ApiOperation({
    summary: 'Discard current ECD Standards self-evaluation draft',
    description: 'Soft-deletes the active draft. Historical submitted assessments are untouched.',
  })
  @ApiOkResponse({ type: SelfEvalDraftEnvelopeDto })
  @ApiStandardClientErrors()
  deleteSelfEvalDraft(@CurrentUser() user: AuthUser) {
    return this.complianceService.deleteSelfEvalDraft(user);
  }

  @Post('self-evaluations')
  @Roles(UserRole.ecd_director)
  @ApiOperation({
    summary: 'Submit ECD Standards self-evaluation',
    description:
      'ECD director submits a scored self-assessment with percent, color rank, and individual Yes/No answers.',
  })
  @ApiCreatedResponse({ type: AssessmentResponseDto })
  @ApiStandardClientErrors()
  @ApiNotFoundError('Center')
  submitSelfEvaluation(@CurrentUser() user: AuthUser, @Body() dto: SubmitSelfEvaluationDto) {
    return this.complianceService.submitSelfEvaluation(user, dto);
  }

  @Post('inspections')
  @Roles(UserRole.district_focal_person, UserRole.sector_focal_person)
  @ApiOperation({
    summary: 'Start supportive supervision inspection draft',
    description:
      'Creates a draft assessment with assessmentType=supportive_supervision for a center in scope.',
  })
  @ApiCreatedResponse({ type: AssessmentDetailResponseDto })
  @ApiStandardClientErrors()
  @ApiNotFoundError('Center')
  createInspection(@CurrentUser() user: AuthUser, @Body() dto: CreateInspectionDto) {
    return this.complianceService.createInspection(user, dto);
  }

  @Put('inspections/:id')
  @Roles(UserRole.district_focal_person, UserRole.sector_focal_person)
  @ApiOperation({
    summary: 'Save supportive supervision inspection draft answers',
    description:
      'Batch upserts Yes/No answers by checklist questionId on a draft inspection. Partial answers allowed.',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Assessment UUID' })
  @ApiOkResponse({ type: AssessmentDetailResponseDto })
  @ApiStandardClientErrors()
  @ApiNotFoundError('Assessment')
  saveInspectionDraft(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SaveInspectionDraftDto,
  ) {
    return this.complianceService.saveInspectionDraft(user, id, dto);
  }

  @Post('inspections/:id/submit')
  @Roles(UserRole.district_focal_person, UserRole.sector_focal_person)
  @ApiOperation({
    summary: 'Submit supportive supervision inspection',
    description:
      'Finalizes a draft inspection with backend-authoritative weighted scoring (same catalog as self-evaluation).',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Assessment UUID' })
  @ApiCreatedResponse({ type: AssessmentResponseDto })
  @ApiStandardClientErrors()
  @ApiNotFoundError('Assessment')
  submitInspection(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SubmitInspectionDto,
  ) {
    return this.complianceService.submitInspection(user, id, dto);
  }

  @Get('assessments/:id')
  @Roles(
    UserRole.caregiver,
    UserRole.ecd_director,
    UserRole.district_focal_person,
    UserRole.sector_focal_person,
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
  getAssessment(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.complianceService.getAssessment(user, id);
  }

  @Post('assessments')
  @Roles(UserRole.district_focal_person, UserRole.sector_focal_person, UserRole.ncda_admin)
  @ApiOperation({
    summary: 'Create compliance assessment',
    description: 'Creates a new center compliance assessment draft/submission.',
  })
  @ApiCreatedResponse({ type: AssessmentResponseDto })
  @ApiStandardClientErrors()
  @ApiNotFoundError('Center')
  createAssessment(@CurrentUser() user: AuthUser, @Body() dto: CreateAssessmentDto) {
    return this.complianceService.createAssessment(user, dto);
  }

  @Patch('assessments/:id')
  @Roles(UserRole.district_focal_person, UserRole.sector_focal_person, UserRole.ncda_admin)
  @ApiOperation({
    summary: 'Update compliance assessment',
    description: 'Updates assessment metadata/status. Requires optimistic-lock `version`.',
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
    UserRole.sector_focal_person,
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
  @Roles(UserRole.district_focal_person, UserRole.sector_focal_person, UserRole.ncda_admin)
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
  @Roles(UserRole.district_focal_person, UserRole.sector_focal_person, UserRole.ncda_admin)
  @ApiOperation({
    summary: 'Update assessment item',
    description: 'Updates an assessment item (response, gaps). Requires optimistic-lock `version`.',
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
    return this.complianceService.updateAssessmentItem(user, assessmentId, itemId, dto);
  }
}

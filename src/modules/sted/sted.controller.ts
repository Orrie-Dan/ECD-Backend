import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
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
import { ListPaginationQueryDto } from '../../common/dto/list-pagination-query.dto';
import {
  ApiDeviceIdHeader,
  ApiNotFoundError,
  ApiStandardClientErrors,
} from '../../common/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuthUser } from '../auth/interfaces/jwt-payload.interface';
import { CreateStedAssessmentDto } from './dto/create-sted-assessment.dto';
import {
  StedAssessmentResponseDto,
  StedHistoryResponseDto,
} from './dto/sted-response.dto';
import { StedService } from './sted.service';

@ApiTags('sted')
@ApiBearerAuth()
@Roles(
  UserRole.caregiver,
  UserRole.ecd_director,
  UserRole.district_focal_person,
  UserRole.ncda_admin,
)
@Controller()
export class StedController {
  constructor(private readonly stedService: StedService) {}

  @Post('sted')
  @ApiOperation({
    summary: 'Create STED assessment',
    description:
      'Creates a STED assessment for a child. REST exposes create + read only — no update/delete.',
  })
  @ApiDeviceIdHeader()
  @ApiCreatedResponse({ type: StedAssessmentResponseDto })
  @ApiStandardClientErrors()
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateStedAssessmentDto,
    @Headers('x-device-id') deviceHeader?: string,
  ) {
    return this.stedService.create(user, {
      ...dto,
      deviceId: dto.deviceId ?? deviceHeader,
    });
  }

  @Get('children/:id/sted-history')
  @ApiOperation({
    summary: 'Get child STED history',
    description: 'Paginated STED assessments for a child (newest first).',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Child ID' })
  @ApiOkResponse({ type: StedHistoryResponseDto })
  @ApiNotFoundError('Child')
  @ApiStandardClientErrors()
  getHistory(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) childId: string,
    @Query() query: ListPaginationQueryDto,
  ) {
    return this.stedService.getHistory(user, childId, query);
  }

  @Get('sted/:id')
  @ApiOperation({
    summary: 'Get STED assessment by ID',
    description: 'Returns a single STED assessment visible in the caller scope.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: StedAssessmentResponseDto })
  @ApiNotFoundError('STED assessment')
  @ApiStandardClientErrors()
  findOne(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.stedService.findOne(user, id);
  }
}

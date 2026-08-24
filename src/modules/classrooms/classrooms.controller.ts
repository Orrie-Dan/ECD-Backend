import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { ApiNotFoundError, ApiStandardClientErrors } from '../../common/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuthUser } from '../auth/interfaces/jwt-payload.interface';
import { ClassroomsService } from './classrooms.service';
import {
  BulkPromoteResponseDto,
  ClassroomResponseDto,
  PromoteChildResponseDto,
} from './dto/classroom-response.dto';
import { BulkPromoteDto, PromoteChildDto } from './dto/promote-child.dto';

@ApiTags('classrooms')
@ApiBearerAuth()
@Controller()
@Roles(
  UserRole.caregiver,
  UserRole.ecd_director,
  UserRole.district_focal_person,
  UserRole.ncda_admin,
)
export class ClassroomsController {
  constructor(private readonly classroomsService: ClassroomsService) {}

  @Get('centers/:centerId/classrooms')
  @ApiOperation({
    summary: 'List classrooms for a center',
    description: 'Returns the 3 fixed classrooms (Grade 1–3) with child counts.',
  })
  @ApiParam({ name: 'centerId', format: 'uuid', description: 'Center UUID' })
  @ApiOkResponse({ type: [ClassroomResponseDto] })
  @ApiStandardClientErrors()
  @ApiNotFoundError('Center')
  findAllByCenter(@Param('centerId', ParseUUIDPipe) centerId: string) {
    return this.classroomsService.findAllByCenter(centerId);
  }

  @Get('classrooms/:id')
  @ApiOperation({
    summary: 'Get classroom detail',
    description: 'Returns a single classroom with enrolled children count.',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Classroom UUID' })
  @ApiOkResponse({ type: ClassroomResponseDto })
  @ApiStandardClientErrors()
  @ApiNotFoundError('Classroom')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.classroomsService.findOne(id);
  }

  @Post('children/:id/promote')
  @ApiOperation({
    summary: 'Promote child to next grade',
    description:
      'Moves a child from current grade to the next. Grade 3 children cannot be promoted.',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Child UUID' })
  @ApiCreatedResponse({ type: PromoteChildResponseDto })
  @ApiStandardClientErrors()
  @ApiNotFoundError('Child')
  promoteChild(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PromoteChildDto,
  ) {
    return this.classroomsService.promoteChild(user, id, dto.effectiveDate);
  }

  @Post('centers/:centerId/promote')
  @ApiOperation({
    summary: 'Bulk promote children in a center',
    description:
      'Promotes all children to the next grade. Grade 3 children are returned for manual archival.',
  })
  @ApiParam({ name: 'centerId', format: 'uuid', description: 'Center UUID' })
  @ApiCreatedResponse({ type: BulkPromoteResponseDto })
  @ApiStandardClientErrors()
  @ApiNotFoundError('Center')
  bulkPromote(
    @CurrentUser() user: AuthUser,
    @Param('centerId', ParseUUIDPipe) centerId: string,
    @Body() dto: BulkPromoteDto,
  ) {
    return this.classroomsService.bulkPromote(
      user,
      centerId,
      dto.effectiveDate,
      dto.excludeChildIds,
    );
  }
}

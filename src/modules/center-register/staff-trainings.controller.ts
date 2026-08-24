import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
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
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuthUser } from '../auth/interfaces/jwt-payload.interface';
import { REGISTER_READ_ROLES, REGISTER_WRITE_ROLES } from './center-register.scope';
import { ListCenterRegisterQueryDto } from './dto/list-center-register-query.dto';
import {
  CreateStaffTrainingDto,
  PaginatedStaffTrainingsResponseDto,
  StaffTrainingResponseDto,
  UpdateStaffTrainingDto,
} from './dto/staff-training.dto';
import { StaffTrainingsService } from './staff-trainings.service';

@ApiTags('staff-trainings')
@ApiBearerAuth()
@Controller('staff-trainings')
export class StaffTrainingsController {
  constructor(private readonly service: StaffTrainingsService) {}

  @Get()
  @Roles(...REGISTER_READ_ROLES)
  @ApiOperation({
    summary: 'List staff trainings',
    description:
      'Caregivers see only their own training history. Other roles see trainings within scope.',
  })
  @ApiOkResponse({ type: PaginatedStaffTrainingsResponseDto })
  @ApiStandardClientErrors()
  list(@CurrentUser() user: AuthUser, @Query() query: ListCenterRegisterQueryDto) {
    return this.service.list(user, query);
  }

  @Get(':id')
  @Roles(...REGISTER_READ_ROLES)
  @ApiOperation({ summary: 'Get a staff training' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: StaffTrainingResponseDto })
  @ApiNotFoundError('Staff training')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.get(user, id);
  }

  @Post()
  @Roles(...REGISTER_WRITE_ROLES)
  @ApiOperation({
    summary: 'Record a staff training',
    description: 'Requires ECD director role at the target centre.',
  })
  @ApiCreatedResponse({ type: StaffTrainingResponseDto })
  @ApiStandardClientErrors()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateStaffTrainingDto) {
    return this.service.create(user, dto);
  }

  @Patch(':id')
  @Roles(...REGISTER_WRITE_ROLES)
  @ApiOperation({
    summary: 'Update a staff training',
    description: 'Requires ECD director role at the record centre.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: StaffTrainingResponseDto })
  @ApiOptimisticLockConflict()
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStaffTrainingDto,
  ) {
    return this.service.update(user, id, dto);
  }
}

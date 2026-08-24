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
import { CenterVisitsService } from './center-visits.service';
import {
  CenterVisitResponseDto,
  CreateCenterVisitDto,
  PaginatedCenterVisitsResponseDto,
  UpdateCenterVisitDto,
} from './dto/center-visit.dto';
import { ListCenterRegisterQueryDto } from './dto/list-center-register-query.dto';

@ApiTags('center-visits')
@ApiBearerAuth()
@Controller('center-visits')
export class CenterVisitsController {
  constructor(private readonly service: CenterVisitsService) {}

  @Get()
  @Roles(...REGISTER_READ_ROLES)
  @ApiOperation({ summary: 'List centre visitors' })
  @ApiOkResponse({ type: PaginatedCenterVisitsResponseDto })
  @ApiStandardClientErrors()
  list(@CurrentUser() user: AuthUser, @Query() query: ListCenterRegisterQueryDto) {
    return this.service.list(user, query);
  }

  @Get(':id')
  @Roles(...REGISTER_READ_ROLES)
  @ApiOperation({ summary: 'Get a centre visit' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: CenterVisitResponseDto })
  @ApiNotFoundError('Center visit')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.get(user, id);
  }

  @Post()
  @Roles(...REGISTER_WRITE_ROLES)
  @ApiOperation({
    summary: 'Record a centre visit',
    description: 'Requires ECD director role at the target centre.',
  })
  @ApiCreatedResponse({ type: CenterVisitResponseDto })
  @ApiStandardClientErrors()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateCenterVisitDto) {
    return this.service.create(user, dto);
  }

  @Patch(':id')
  @Roles(...REGISTER_WRITE_ROLES)
  @ApiOperation({
    summary: 'Update a centre visit',
    description: 'Requires ECD director role at the record centre.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: CenterVisitResponseDto })
  @ApiOptimisticLockConflict()
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCenterVisitDto,
  ) {
    return this.service.update(user, id, dto);
  }
}

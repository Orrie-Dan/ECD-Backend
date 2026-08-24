import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
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
  ApiNotFoundError,
  ApiOptimisticLockConflict,
  ApiStandardClientErrors,
} from '../../common/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuthUser } from '../auth/interfaces/jwt-payload.interface';
import { ListCenterRegisterQueryDto } from './dto/list-center-register-query.dto';
import {
  CreateParentingSessionDto,
  PaginatedParentingSessionsResponseDto,
  ParentingSessionResponseDto,
  UpdateParentingSessionDto,
} from './dto/parenting-session.dto';
import { ParentingSessionsService } from './parenting-sessions.service';
import { REGISTER_READ_ROLES, REGISTER_WRITE_ROLES } from './center-register.scope';

@ApiTags('parenting-sessions')
@ApiBearerAuth()
@Controller('parenting-sessions')
export class ParentingSessionsController {
  constructor(private readonly service: ParentingSessionsService) {}

  @Get()
  @Roles(...REGISTER_READ_ROLES)
  @ApiOperation({ summary: 'List parenting sessions' })
  @ApiOkResponse({ type: PaginatedParentingSessionsResponseDto })
  @ApiStandardClientErrors()
  list(@CurrentUser() user: AuthUser, @Query() query: ListCenterRegisterQueryDto) {
    return this.service.list(user, query);
  }

  @Get(':id')
  @Roles(...REGISTER_READ_ROLES)
  @ApiOperation({ summary: 'Get parenting session' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ParentingSessionResponseDto })
  @ApiNotFoundError('Parenting session')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.get(user, id);
  }

  @Post()
  @Roles(...REGISTER_WRITE_ROLES)
  @ApiOperation({
    summary: 'Record a parenting session',
    description: 'Requires ECD director role at the target centre.',
  })
  @ApiCreatedResponse({ type: ParentingSessionResponseDto })
  @ApiStandardClientErrors()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateParentingSessionDto) {
    return this.service.create(user, dto);
  }

  @Patch(':id')
  @Roles(...REGISTER_WRITE_ROLES)
  @ApiOperation({ summary: 'Update a parenting session' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ParentingSessionResponseDto })
  @ApiOptimisticLockConflict()
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateParentingSessionDto,
  ) {
    return this.service.update(user, id, dto);
  }
}

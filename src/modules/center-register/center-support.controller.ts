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
import { CenterSupportService } from './center-support.service';
import {
  CenterSupportResponseDto,
  CreateCenterSupportDto,
  PaginatedCenterSupportResponseDto,
  UpdateCenterSupportDto,
} from './dto/center-support.dto';
import { ListCenterRegisterQueryDto } from './dto/list-center-register-query.dto';

@ApiTags('center-support')
@ApiBearerAuth()
@Controller('center-support')
export class CenterSupportController {
  constructor(private readonly service: CenterSupportService) {}

  @Get()
  @Roles(...REGISTER_READ_ROLES)
  @ApiOperation({ summary: 'List support received by centres' })
  @ApiOkResponse({ type: PaginatedCenterSupportResponseDto })
  @ApiStandardClientErrors()
  list(@CurrentUser() user: AuthUser, @Query() query: ListCenterRegisterQueryDto) {
    return this.service.list(user, query);
  }

  @Get(':id')
  @Roles(...REGISTER_READ_ROLES)
  @ApiOperation({ summary: 'Get support record' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: CenterSupportResponseDto })
  @ApiNotFoundError('Center support record')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.get(user, id);
  }

  @Post()
  @Roles(...REGISTER_WRITE_ROLES)
  @ApiOperation({
    summary: 'Record support received',
    description: 'Requires ECD director role at the target centre.',
  })
  @ApiCreatedResponse({ type: CenterSupportResponseDto })
  @ApiStandardClientErrors()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateCenterSupportDto) {
    return this.service.create(user, dto);
  }

  @Patch(':id')
  @Roles(...REGISTER_WRITE_ROLES)
  @ApiOperation({
    summary: 'Update a support record',
    description: 'Requires ECD director role at the record centre.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: CenterSupportResponseDto })
  @ApiOptimisticLockConflict()
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCenterSupportDto,
  ) {
    return this.service.update(user, id, dto);
  }
}

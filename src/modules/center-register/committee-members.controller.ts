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
import { CommitteeMembersService } from './committee-members.service';
import {
  CommitteeMemberResponseDto,
  CreateCommitteeMemberDto,
  DeactivateCommitteeMemberDto,
  PaginatedCommitteeMembersResponseDto,
  UpdateCommitteeMemberDto,
} from './dto/committee-member.dto';
import { ListCenterRegisterQueryDto } from './dto/list-center-register-query.dto';

@ApiTags('committee-members')
@ApiBearerAuth()
@Controller('committee-members')
export class CommitteeMembersController {
  constructor(private readonly service: CommitteeMembersService) {}

  @Get()
  @Roles(...REGISTER_READ_ROLES)
  @ApiOperation({ summary: 'List ECD committee members' })
  @ApiOkResponse({ type: PaginatedCommitteeMembersResponseDto })
  @ApiStandardClientErrors()
  list(@CurrentUser() user: AuthUser, @Query() query: ListCenterRegisterQueryDto) {
    return this.service.list(user, query);
  }

  @Get(':id')
  @Roles(...REGISTER_READ_ROLES)
  @ApiOperation({ summary: 'Get committee member' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: CommitteeMemberResponseDto })
  @ApiNotFoundError('Committee member')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.get(user, id);
  }

  @Post()
  @Roles(...REGISTER_WRITE_ROLES)
  @ApiOperation({
    summary: 'Add a committee member',
    description: 'Requires ECD director role at the target centre.',
  })
  @ApiCreatedResponse({ type: CommitteeMemberResponseDto })
  @ApiStandardClientErrors()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateCommitteeMemberDto) {
    return this.service.create(user, dto);
  }

  @Patch(':id')
  @Roles(...REGISTER_WRITE_ROLES)
  @ApiOperation({ summary: 'Update a committee member' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: CommitteeMemberResponseDto })
  @ApiOptimisticLockConflict()
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCommitteeMemberDto,
  ) {
    return this.service.update(user, id, dto);
  }

  @Post(':id/deactivate')
  @Roles(...REGISTER_WRITE_ROLES)
  @ApiOperation({
    summary: 'End committee membership',
    description: 'Sets isActive=false and endDate. The row is retained for history.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: CommitteeMemberResponseDto })
  @ApiOptimisticLockConflict()
  deactivate(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DeactivateCommitteeMemberDto,
  ) {
    return this.service.deactivate(user, id, dto);
  }
}

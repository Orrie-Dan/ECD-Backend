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
  ApiNotFoundError,
  ApiStandardClientErrors,
} from '../../common/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuthUser } from '../auth/interfaces/jwt-payload.interface';
import { CreateUserDto } from './dto/create-user.dto';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { ResetUserPasswordDto } from './dto/reset-user-password.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import {
  CreateUserResponseDto,
  PaginatedUsersResponseDto,
  ResetUserPasswordResponseDto,
  UserResponseDto,
} from './dto/user-response.dto';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
@Roles(UserRole.ecd_director, UserRole.district_focal_person, UserRole.ncda_admin)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @ApiOperation({
    summary: 'Create a user',
    description:
      'Provisions a new user account within the caller management scope. ' +
      'NCDA can create district officers, ECD directors, and caregivers; ' +
      'district officers can create ECD directors and caregivers in their district; ' +
      'ECD directors can create caregivers at their center. ' +
      'Returns a one-time `temporaryPassword` that must be shared out-of-band; ' +
      'it is never included on subsequent GET/list/update responses.',
  })
  @ApiCreatedResponse({ type: CreateUserResponseDto })
  @ApiStandardClientErrors()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateUserDto) {
    return this.usersService.create(user, dto);
  }

  @Get()
  @ApiOperation({
    summary: 'List users',
    description:
      'Returns a paginated list of users visible to the caller. ' +
      'ECD directors see caregivers at their center only. ' +
      'Pagination shape uses `data` (not `items`) and omits `totalPages`.',
  })
  @ApiOkResponse({ type: PaginatedUsersResponseDto })
  @ApiStandardClientErrors()
  findAll(@CurrentUser() user: AuthUser, @Query() query: ListUsersQueryDto) {
    return this.usersService.findAll(user, query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get user by id',
    description: 'Returns a single user visible in the caller management scope.',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'User account UUID' })
  @ApiOkResponse({ type: UserResponseDto })
  @ApiStandardClientErrors()
  @ApiNotFoundError('User')
  findOne(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.usersService.findOne(user, id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update a user',
    description:
      'Partial update of user profile/status fields within caller scope. ' +
      'Set `status` to `SUSPENDED` to deactivate (remove) a caregiver.',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'User account UUID' })
  @ApiOkResponse({ type: UserResponseDto })
  @ApiStandardClientErrors()
  @ApiNotFoundError('User')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
  ) {
    return this.usersService.update(user, id, dto);
  }

  @Post(':id/reset-password')
  @ApiOperation({
    summary: 'Reset user password',
    description:
      'Resets the target user password. When `newPassword` is omitted, a temporary ' +
      'password is generated and returned once as `temporaryPassword`. When an ' +
      'explicit password is provided, it is not echoed in the response.',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'User account UUID' })
  @ApiOkResponse({ type: ResetUserPasswordResponseDto })
  @ApiStandardClientErrors()
  @ApiNotFoundError('User')
  resetPassword(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResetUserPasswordDto,
  ) {
    return this.usersService.resetPassword(user, id, dto);
  }
}

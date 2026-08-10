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
  PaginatedUsersResponseDto,
  UserResponseDto,
} from './dto/user-response.dto';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
@Roles(UserRole.district_focal_person, UserRole.ncda_admin)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @ApiOperation({
    summary: 'Create a user',
    description:
      'Provisions a new user account within the caller management scope. ' +
      'Temporary credentials are not returned in the response.',
  })
  @ApiCreatedResponse({ type: UserResponseDto })
  @ApiStandardClientErrors()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateUserDto) {
    return this.usersService.create(user, dto);
  }

  @Get()
  @ApiOperation({
    summary: 'List users',
    description:
      'Returns a paginated list of users visible to the caller. ' +
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
      'Partial update of user profile/role/status fields within caller scope.',
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
      'Resets the target user password. Never returns the password in the response; ' +
      'returns `{ success: true }` on success.',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'User account UUID' })
  @ApiOkResponse({
    description: 'Password reset accepted',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
      },
      required: ['success'],
    },
  })
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

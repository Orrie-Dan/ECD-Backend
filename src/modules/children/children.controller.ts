import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  GoneException,
  Headers,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiGoneResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import {
  ApiDeviceIdHeader,
  ApiNotFoundError,
  ApiOptimisticLockConflict,
  ApiStandardClientErrors,
  ErrorResponseDto,
} from '../../common/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuthUser } from '../auth/interfaces/jwt-payload.interface';
import { ChildrenService } from './children.service';
import { ArchiveChildDto } from './dto/archive-child.dto';
import {
  ChildDetailResponseDto,
  PaginatedChildrenResponseDto,
} from './dto/child-response.dto';
import { CreateChildDto } from './dto/create-child.dto';
import { ListChildrenQueryDto } from './dto/list-children-query.dto';
import { ReactivateChildDto } from './dto/reactivate-child.dto';
import { TransferChildDto } from './dto/transfer-child.dto';
import { UpdateChildDto } from './dto/update-child.dto';

@ApiTags('children')
@ApiBearerAuth()
@Controller('children')
@Roles(
  UserRole.caregiver,
  UserRole.district_focal_person,
  UserRole.ncda_admin,
)
export class ChildrenController {
  constructor(private readonly childrenService: ChildrenService) {}

  @Post()
  @ApiOperation({
    summary: 'Register a child',
    description:
      'Creates a new child at an accessible center. Optional `x-device-id` header ' +
      'is merged as body.deviceId ?? header for offline device attribution.',
  })
  @ApiCreatedResponse({ type: ChildDetailResponseDto })
  @ApiDeviceIdHeader()
  @ApiStandardClientErrors()
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateChildDto,
    @Headers('x-device-id') deviceHeader?: string,
  ) {
    return this.childrenService.create(user, {
      ...dto,
      deviceId: dto.deviceId ?? deviceHeader,
    });
  }

  @Get()
  @ApiOperation({
    summary: 'List children',
    description:
      'Returns a paginated list of children visible in the caller scope. ' +
      'List items omit detail-only fields such as notes and version.',
  })
  @ApiOkResponse({ type: PaginatedChildrenResponseDto })
  @ApiStandardClientErrors()
  findAll(@CurrentUser() user: AuthUser, @Query() query: ListChildrenQueryDto) {
    return this.childrenService.findAll(user, query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get child by id',
    description:
      'Returns full child detail including notes, specialNeeds, archivedAt, and version.',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Child UUID' })
  @ApiOkResponse({ type: ChildDetailResponseDto })
  @ApiStandardClientErrors()
  @ApiNotFoundError('Child')
  findOne(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.childrenService.findOne(user, id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update a child',
    description:
      'Partial update with optimistic locking via body.version (currentVersion). ' +
      'Optional `x-device-id` merges as body.deviceId ?? header.',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Child UUID' })
  @ApiOkResponse({ type: ChildDetailResponseDto })
  @ApiDeviceIdHeader()
  @ApiStandardClientErrors()
  @ApiNotFoundError('Child')
  @ApiOptimisticLockConflict()
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateChildDto,
    @Headers('x-device-id') deviceHeader?: string,
  ) {
    return this.childrenService.update(user, id, {
      ...dto,
      deviceId: dto.deviceId ?? deviceHeader,
    });
  }

  @Post(':id/archive')
  @ApiOperation({
    summary: 'Archive a child',
    description:
      'Marks the child as archived (optimistic lock via body.version). ' +
      'Optional `x-device-id` merges as body.deviceId ?? header.',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Child UUID' })
  @ApiOkResponse({ type: ChildDetailResponseDto })
  @ApiDeviceIdHeader()
  @ApiStandardClientErrors()
  @ApiNotFoundError('Child')
  @ApiOptimisticLockConflict()
  archive(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ArchiveChildDto,
    @Headers('x-device-id') deviceHeader?: string,
  ) {
    return this.childrenService.archive(user, id, {
      ...dto,
      deviceId: dto.deviceId ?? deviceHeader,
    });
  }

  @Post(':id/reactivate')
  @ApiOperation({
    summary: 'Reactivate an archived child',
    description:
      'Restores an archived child to active status (optimistic lock via body.version). ' +
      'Optional `x-device-id` merges as body.deviceId ?? header.',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Child UUID' })
  @ApiOkResponse({ type: ChildDetailResponseDto })
  @ApiDeviceIdHeader()
  @ApiStandardClientErrors()
  @ApiNotFoundError('Child')
  @ApiOptimisticLockConflict()
  reactivate(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReactivateChildDto,
    @Headers('x-device-id') deviceHeader?: string,
  ) {
    return this.childrenService.reactivate(user, id, {
      ...dto,
      deviceId: dto.deviceId ?? deviceHeader,
    });
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Soft-delete a child',
    description:
      'Soft-deletes the child using optimistic lock. Query `version` is required. ' +
      'Device attribution via `x-device-id` header or optional `deviceId` query.',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Child UUID' })
  @ApiQuery({
    name: 'version',
    required: true,
    type: Number,
    description: 'Expected current version (non-negative integer)',
  })
  @ApiQuery({
    name: 'deviceId',
    required: false,
    type: String,
    description:
      'Optional Device registry UUID; used when `x-device-id` header is absent',
  })
  @ApiOkResponse({ type: ChildDetailResponseDto })
  @ApiDeviceIdHeader()
  @ApiStandardClientErrors()
  @ApiNotFoundError('Child')
  @ApiOptimisticLockConflict()
  softDelete(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('version') versionRaw: string,
    @Headers('x-device-id') deviceHeader?: string,
    @Query('deviceId') deviceQuery?: string,
  ) {
    const version = Number(versionRaw);
    if (!Number.isInteger(version) || version < 0) {
      throw new BadRequestException(
        'Query parameter version (non-negative integer) is required',
      );
    }
    return this.childrenService.softDelete(
      user,
      id,
      version,
      deviceHeader ?? deviceQuery,
    );
  }

  /**
   * @deprecated Use POST /transfers
   */
  @Post(':id/transfer')
  @ApiOperation({
    summary: 'Transfer child (deprecated)',
    description:
      'Deprecated. Always returns HTTP 410 Gone. Use POST /api/v1/transfers instead.',
    deprecated: true,
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Child UUID' })
  @ApiGoneResponse({
    description:
      'Endpoint removed — use POST /api/v1/transfers for child transfers',
    type: ErrorResponseDto,
  })
  @ApiStandardClientErrors()
  transfer(
    @Param('id', ParseUUIDPipe) _id: string,
    @Body() _dto: TransferChildDto,
  ): never {
    throw new GoneException(
      'POST /children/:id/transfer has been removed. Use POST /api/v1/transfers instead.',
    );
  }
}

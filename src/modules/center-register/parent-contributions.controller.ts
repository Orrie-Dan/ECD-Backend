import {
  Body,
  Controller,
  Delete,
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
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, Min } from 'class-validator';
import {
  ApiNotFoundError,
  ApiOptimisticLockConflict,
  ApiStandardClientErrors,
} from '../../common/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuthUser } from '../auth/interfaces/jwt-payload.interface';
import { CreateParentContributionDto } from './dto/create-parent-contribution.dto';
import { ListCenterRegisterQueryDto } from './dto/list-center-register-query.dto';
import {
  PaginatedParentContributionsResponseDto,
  ParentContributionResponseDto,
  ParentContributionSummaryDto,
} from './dto/parent-contribution-response.dto';
import { UpdateParentContributionDto } from './dto/update-parent-contribution.dto';
import { ParentContributionsService } from './parent-contributions.service';
import {
  REGISTER_READ_ROLES,
  REGISTER_SUMMARY_ROLES,
  REGISTER_WRITE_ROLES,
} from './center-register.scope';

class ArchiveVersionQuery {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version: number;
}

@ApiTags('parent-contributions')
@ApiBearerAuth()
@Controller('contributions')
export class ParentContributionsController {
  constructor(private readonly service: ParentContributionsService) {}

  @Get()
  @Roles(...REGISTER_READ_ROLES)
  @ApiOperation({ summary: 'List parent contributions' })
  @ApiOkResponse({ type: PaginatedParentContributionsResponseDto })
  @ApiStandardClientErrors()
  list(@CurrentUser() user: AuthUser, @Query() query: ListCenterRegisterQueryDto) {
    return this.service.list(user, query);
  }

  @Get('summary')
  @Roles(...REGISTER_SUMMARY_ROLES)
  @ApiOperation({
    summary: 'Contribution totals',
    description:
      'Derived paper-register totals (cash contributors, cash amount, in-kind contributors). Not stored as authoritative fields.',
  })
  @ApiOkResponse({ type: ParentContributionSummaryDto })
  @ApiStandardClientErrors()
  summary(@CurrentUser() user: AuthUser, @Query() query: ListCenterRegisterQueryDto) {
    return this.service.summary(user, query);
  }

  @Get(':id')
  @Roles(...REGISTER_READ_ROLES)
  @ApiOperation({ summary: 'Get parent contribution' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ParentContributionResponseDto })
  @ApiNotFoundError('Parent contribution')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.get(user, id);
  }

  @Post()
  @Roles(...REGISTER_WRITE_ROLES)
  @ApiOperation({
    summary: 'Record a parent contribution',
    description: 'Requires ECD director role at the target centre.',
  })
  @ApiCreatedResponse({ type: ParentContributionResponseDto })
  @ApiStandardClientErrors()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateParentContributionDto) {
    return this.service.create(user, dto);
  }

  @Patch(':id')
  @Roles(...REGISTER_WRITE_ROLES)
  @ApiOperation({ summary: 'Update a parent contribution' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ParentContributionResponseDto })
  @ApiOptimisticLockConflict()
  @ApiStandardClientErrors()
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateParentContributionDto,
  ) {
    return this.service.update(user, id, dto);
  }

  @Delete(':id')
  @Roles(...REGISTER_WRITE_ROLES)
  @ApiOperation({ summary: 'Archive a parent contribution' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiNoContentResponse()
  @ApiOptimisticLockConflict()
  async archive(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ArchiveVersionQuery,
  ) {
    await this.service.archive(user, id, query.version);
  }
}

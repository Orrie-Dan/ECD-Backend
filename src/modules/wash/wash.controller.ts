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
  ApiAuthErrors,
  ApiNotFoundError,
  ApiOptimisticLockConflict,
  ApiStandardClientErrors,
} from '../../common/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuthUser } from '../auth/interfaces/jwt-payload.interface';
import { WashService } from './wash.service';
import { CreateWashIndicatorDto } from './dto/create-wash-indicator.dto';
import { ListWashIndicatorsQueryDto } from './dto/list-wash-indicators-query.dto';
import { UpdateWashIndicatorDto } from './dto/update-wash-indicator.dto';
import {
  PaginatedWashIndicatorsResponseDto,
  WashIndicatorResponseDto,
} from './dto/wash-indicator-response.dto';

@ApiTags('wash')
@ApiBearerAuth()
@Controller('wash/indicators')
export class WashController {
  constructor(private readonly washService: WashService) {}

  @Get()
  @Roles(
    UserRole.caregiver,
    UserRole.ecd_director,
    UserRole.district_focal_person,
    UserRole.ncda_admin,
  )
  @ApiOperation({
    summary: 'List WASH indicators',
    description: 'Paginated WASH indicator records scoped to the caller.',
  })
  @ApiOkResponse({ type: PaginatedWashIndicatorsResponseDto })
  @ApiStandardClientErrors()
  listIndicators(
    @CurrentUser() user: AuthUser,
    @Query() query: ListWashIndicatorsQueryDto,
  ) {
    return this.washService.listIndicators(user, query);
  }

  @Get(':id')
  @Roles(
    UserRole.caregiver,
    UserRole.ecd_director,
    UserRole.district_focal_person,
    UserRole.ncda_admin,
  )
  @ApiOperation({
    summary: 'Get WASH indicator',
    description: 'Returns a single WASH indicator by id.',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'WASH indicator UUID' })
  @ApiOkResponse({ type: WashIndicatorResponseDto })
  @ApiAuthErrors()
  @ApiNotFoundError('WASH indicator')
  getIndicator(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.washService.getIndicator(user, id);
  }

  @Post()
  @Roles(UserRole.district_focal_person, UserRole.ncda_admin)
  @ApiOperation({
    summary: 'Create WASH indicator',
    description: 'Records a new WASH indicator snapshot for a center.',
  })
  @ApiCreatedResponse({ type: WashIndicatorResponseDto })
  @ApiStandardClientErrors()
  @ApiNotFoundError('Center')
  createIndicator(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateWashIndicatorDto,
  ) {
    return this.washService.createIndicator(user, dto);
  }

  @Patch(':id')
  @Roles(UserRole.district_focal_person, UserRole.ncda_admin)
  @ApiOperation({
    summary: 'Update WASH indicator',
    description:
      'Updates a WASH indicator. Requires optimistic-lock `version`.',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'WASH indicator UUID' })
  @ApiOkResponse({ type: WashIndicatorResponseDto })
  @ApiStandardClientErrors()
  @ApiNotFoundError('WASH indicator')
  @ApiOptimisticLockConflict()
  updateIndicator(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWashIndicatorDto,
  ) {
    return this.washService.updateIndicator(user, id, dto);
  }
}

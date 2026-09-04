import { UserRole } from '../../common/domain';
import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  ApiAuthErrors,
  ApiDeviceIdHeader,
  ApiNotFoundError,
  ApiOptimisticLockConflict,
  ApiStandardClientErrors,
} from '../../common/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuthUser } from '../auth/interfaces/jwt-payload.interface';
import { CentersService } from './centers.service';
import {
  CenterDetailResponseDto,
  CenterResponseDto,
  PaginatedCentersResponseDto,
} from './dto/center-response.dto';
import { ListCentersQueryDto } from './dto/list-centers-query.dto';
import { UpdateCenterDto } from './dto/update-center.dto';

@ApiTags('centers')
@ApiBearerAuth()
@Controller('centers')
export class CentersController {
  constructor(private readonly centersService: CentersService) {}

  @Get()
  @Roles(
    UserRole.caregiver,
    UserRole.ecd_director,
    UserRole.district_focal_person,
    UserRole.ncda_admin,
  )
  @ApiOperation({
    summary: 'List ECD centers',
    description:
      'Returns paginated centers visible in the caller scope (caregiver center, district, or national).',
  })
  @ApiOkResponse({ type: PaginatedCentersResponseDto })
  @ApiStandardClientErrors()
  findAll(@CurrentUser() user: AuthUser, @Query() query: ListCentersQueryDto) {
    return this.centersService.findAll(user, query);
  }

  @Get(':id')
  @Roles(
    UserRole.caregiver,
    UserRole.ecd_director,
    UserRole.district_focal_person,
    UserRole.ncda_admin,
  )
  @ApiOperation({
    summary: 'Get center detail',
    description:
      'Returns a single center with province, caregiver count, and today attendance/referral snapshots.',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Center UUID' })
  @ApiOkResponse({ type: CenterDetailResponseDto })
  @ApiAuthErrors()
  @ApiNotFoundError('Center')
  findOne(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.centersService.findOne(user, id);
  }

  @Patch(':id')
  @Roles(UserRole.district_focal_person, UserRole.ncda_admin)
  @ApiOperation({
    summary: 'Update center',
    description:
      'Partially updates a center. Requires optimistic-lock `version`. Optional `x-device-id` / body.deviceId for offline attribution.',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Center UUID' })
  @ApiDeviceIdHeader()
  @ApiOkResponse({ type: CenterResponseDto })
  @ApiStandardClientErrors()
  @ApiNotFoundError('Center')
  @ApiOptimisticLockConflict()
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCenterDto,
    @Headers('x-device-id') deviceHeader?: string,
  ) {
    return this.centersService.update(user, id, {
      ...dto,
      deviceId: dto.deviceId ?? deviceHeader,
    });
  }
}

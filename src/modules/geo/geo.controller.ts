import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import {
  ApiAuthErrors,
  ApiNotFoundError,
  ApiStandardClientErrors,
} from '../../common/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuthUser } from '../auth/interfaces/jwt-payload.interface';
import { GeoService } from './geo.service';
import {
  AdminUnitResponseDto,
  DistrictResponseDto,
  PaginatedCentersInDistrictResponseDto,
  PaginatedDistrictsResponseDto,
} from './dto/geo-response.dto';
import { ListAdminUnitsQueryDto } from './dto/list-admin-units-query.dto';
import { ListCentersByDistrictQueryDto } from './dto/list-centers-by-district-query.dto';
import { ListDistrictsQueryDto } from './dto/list-districts-query.dto';

@ApiTags('geo')
@ApiBearerAuth()
@Controller()
export class GeoController {
  constructor(private readonly geoService: GeoService) {}

  @Get('admin-units')
  @Roles(
    UserRole.caregiver,
    UserRole.ecd_director,
    UserRole.district_focal_person,
    UserRole.ncda_admin,
  )
  @ApiOperation({
    summary: 'List administrative units',
    description:
      'Returns villages/sectors/cells filtered by district, parent, or level.',
  })
  @ApiOkResponse({ type: [AdminUnitResponseDto] })
  @ApiStandardClientErrors()
  listAdminUnits(
    @CurrentUser() user: AuthUser,
    @Query() query: ListAdminUnitsQueryDto,
  ) {
    return this.geoService.listAdminUnits(user, query);
  }

  @Get('districts')
  @Roles(
    UserRole.caregiver,
    UserRole.ecd_director,
    UserRole.district_focal_person,
    UserRole.ncda_admin,
  )
  @ApiOperation({
    summary: 'List districts',
    description:
      'Paginated districts. Center staff and district focal persons are scoped to their district.',
  })
  @ApiOkResponse({ type: PaginatedDistrictsResponseDto })
  @ApiStandardClientErrors()
  listDistricts(
    @CurrentUser() user: AuthUser,
    @Query() query: ListDistrictsQueryDto,
  ) {
    return this.geoService.listDistricts(user, query);
  }

  @Get('districts/:id')
  @Roles(
    UserRole.caregiver,
    UserRole.ecd_director,
    UserRole.district_focal_person,
    UserRole.ncda_admin,
  )
  @ApiOperation({
    summary: 'Get district by id',
    description:
      'Returns a single district. Center staff and district focal persons are limited to their own district.',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'District UUID' })
  @ApiOkResponse({ type: DistrictResponseDto })
  @ApiStandardClientErrors()
  @ApiNotFoundError('District')
  getDistrict(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) districtId: string,
  ) {
    return this.geoService.getDistrict(user, districtId);
  }

  @Get('districts/:id/centers')
  @Roles(UserRole.district_focal_person, UserRole.ncda_admin)
  @ApiOperation({
    summary: 'List centers in a district',
    description: 'Paginated ECD centers belonging to the given district.',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'District UUID' })
  @ApiOkResponse({ type: PaginatedCentersInDistrictResponseDto })
  @ApiStandardClientErrors()
  @ApiNotFoundError('District')
  listCentersByDistrict(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) districtId: string,
    @Query() query: ListCentersByDistrictQueryDto,
  ) {
    return this.geoService.listCentersByDistrict(user, districtId, query);
  }
}

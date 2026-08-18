import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { ApiDeviceIdHeader, ApiNotFoundError, ApiStandardClientErrors } from '../../common/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuthUser } from '../auth/interfaces/jwt-payload.interface';
import { CreateNutritionScreeningDto } from './dto/create-nutrition-screening.dto';
import { GrowthChartResponseDto } from './dto/growth-chart-response.dto';
import { ListNutritionQueryDto } from './dto/list-nutrition-query.dto';
import { ListNutritionScreeningsQueryDto } from './dto/list-nutrition-screenings-query.dto';
import { NutritionAlertsResponseDto } from './dto/nutrition-alert.dto';
import { NutritionHistoryResponseDto } from './dto/nutrition-history-response.dto';
import { PaginatedNutritionScreeningsResponseDto } from './dto/nutrition-screening-list-response.dto';
import { NutritionScreeningResponseDto } from './dto/nutrition-screening-response.dto';
import { NutritionService } from './nutrition.service';

@ApiTags('nutrition')
@ApiBearerAuth()
@Roles(
  UserRole.caregiver,
  UserRole.ecd_director,
  UserRole.district_focal_person,
  UserRole.ncda_admin,
)
@Controller()
export class NutritionController {
  constructor(private readonly nutritionService: NutritionService) {}

  @Post('children/:id/nutrition-screenings')
  @ApiOperation({
    summary: 'Create nutrition screening',
    description:
      'Records a nutrition screening for a child. May set requiresReferral based on MUAC/status rules.',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Child ID' })
  @ApiDeviceIdHeader()
  @ApiCreatedResponse({ type: NutritionScreeningResponseDto })
  @ApiNotFoundError('Child')
  @ApiStandardClientErrors()
  createScreening(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) childId: string,
    @Body() dto: CreateNutritionScreeningDto,
    @Headers('x-device-id') deviceHeader?: string,
  ) {
    return this.nutritionService.createScreening(user, childId, {
      ...dto,
      deviceId: dto.deviceId ?? deviceHeader,
    });
  }

  @Get('nutrition/screenings')
  @ApiOperation({
    summary: 'List nutrition screenings',
    description:
      'Paginated operational screening records in caller scope. Filters by center (via child), child, inclusive screeningDate range (from/to), and nutritionStatus. No default date window.',
  })
  @ApiOkResponse({ type: PaginatedNutritionScreeningsResponseDto })
  @ApiStandardClientErrors()
  listScreenings(@CurrentUser() user: AuthUser, @Query() query: ListNutritionScreeningsQueryDto) {
    return this.nutritionService.listScreenings(user, query);
  }

  @Get('children/:id/nutrition-history')
  @ApiOperation({
    summary: 'Get child nutrition history',
    description: 'Returns all nutrition screenings for a child (newest first).',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Child ID' })
  @ApiOkResponse({ type: NutritionHistoryResponseDto })
  @ApiNotFoundError('Child')
  @ApiStandardClientErrors()
  getHistory(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) childId: string) {
    return this.nutritionService.getHistory(user, childId);
  }

  @Get('children/:id/growth-chart')
  @ApiOperation({
    summary: 'Get child growth chart series',
    description: 'Returns weight, MUAC, height, and head circumference time series for charting.',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Child ID' })
  @ApiOkResponse({ type: GrowthChartResponseDto })
  @ApiNotFoundError('Child')
  @ApiStandardClientErrors()
  getGrowthChart(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) childId: string) {
    return this.nutritionService.getGrowthChart(user, childId);
  }

  @Get('nutrition/alerts')
  @ApiOperation({
    summary: 'List nutrition alerts',
    description:
      'Returns overdue screening, referral-required, and severe nutrition alerts in caller scope.',
  })
  @ApiOkResponse({ type: NutritionAlertsResponseDto })
  @ApiStandardClientErrors()
  getAlerts(@CurrentUser() user: AuthUser, @Query() query: ListNutritionQueryDto) {
    return this.nutritionService.getAlerts(user, query);
  }
}

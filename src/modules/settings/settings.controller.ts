import { Body, Controller, Get, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { ApiStandardClientErrors } from '../../common/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuthUser } from '../auth/interfaces/jwt-payload.interface';
import { SettingsService } from './settings.service';
import { ListSettingsQueryDto } from './dto/list-settings-query.dto';
import { SettingResponseDto } from './dto/setting-response.dto';
import { UpsertSettingDto } from './dto/upsert-setting.dto';

@ApiTags('settings')
@ApiBearerAuth()
@Controller('settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  @Roles(UserRole.district_focal_person, UserRole.ncda_admin)
  @ApiOperation({
    summary: 'List district settings',
    description: 'Returns app settings for a district. NCDA admins must supply districtId.',
  })
  @ApiOkResponse({ type: [SettingResponseDto] })
  @ApiStandardClientErrors()
  findAll(@CurrentUser() user: AuthUser, @Query() query: ListSettingsQueryDto) {
    return this.settingsService.findAll(user, query);
  }

  @Patch()
  @Roles(UserRole.district_focal_person, UserRole.ncda_admin)
  @ApiOperation({
    summary: 'Upsert district setting',
    description: 'Creates or updates a key/value setting for a district.',
  })
  @ApiOkResponse({ type: SettingResponseDto })
  @ApiStandardClientErrors()
  upsert(@CurrentUser() user: AuthUser, @Body() dto: UpsertSettingDto) {
    return this.settingsService.upsert(user, dto);
  }
}

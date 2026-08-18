import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
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
} from '../../common/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuthUser } from '../auth/interfaces/jwt-payload.interface';
import { AttendanceService } from './attendance.service';
import { AttendanceBatchDto } from './dto/attendance-batch.dto';
import {
  AttendanceBatchResultDto,
  AttendanceResponseDto,
  PaginatedAttendanceResponseDto,
} from './dto/attendance-response.dto';
import { ListAttendanceQueryDto } from './dto/list-attendance-query.dto';

@ApiTags('attendance')
@ApiBearerAuth()
@Controller('attendance')
@Roles(
  UserRole.caregiver,
  UserRole.ecd_director,
  UserRole.district_focal_person,
  UserRole.ncda_admin,
)
export class AttendanceController {
  constructor(private readonly attendanceService: AttendanceService) {}

  @Post('batch')
  @ApiOperation({
    summary: 'Upsert attendance batch',
    description:
      'Creates or updates multiple attendance records in one request. ' +
      'Per-item outcomes (created/updated/failed/forbidden/not_found/conflict) ' +
      'are returned in the result. Optional `x-device-id` merges as body.deviceId ?? header.',
  })
  @ApiCreatedResponse({ type: AttendanceBatchResultDto })
  @ApiDeviceIdHeader()
  @ApiStandardClientErrors()
  createBatch(
    @CurrentUser() user: AuthUser,
    @Body() dto: AttendanceBatchDto,
    @Headers('x-device-id') deviceHeader?: string,
  ) {
    return this.attendanceService.createBatch(user, {
      ...dto,
      deviceId: dto.deviceId ?? deviceHeader,
    });
  }

  @Get()
  @ApiOperation({
    summary: 'List attendance records',
    description:
      'Returns a paginated list of attendance records visible in the caller scope.',
  })
  @ApiOkResponse({ type: PaginatedAttendanceResponseDto })
  @ApiStandardClientErrors()
  findAll(
    @CurrentUser() user: AuthUser,
    @Query() query: ListAttendanceQueryDto,
  ) {
    return this.attendanceService.findAll(user, query);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Soft-delete an attendance record',
    description:
      'Soft-deletes an attendance record using optimistic lock. ' +
      'Query `version` is required. Optional `x-device-id` for device attribution.',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Attendance record UUID' })
  @ApiQuery({
    name: 'version',
    required: true,
    type: Number,
    description: 'Expected current version (non-negative integer)',
  })
  @ApiOkResponse({ type: AttendanceResponseDto })
  @ApiDeviceIdHeader()
  @ApiStandardClientErrors()
  @ApiNotFoundError('Attendance record')
  @ApiOptimisticLockConflict()
  softDelete(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('version') versionRaw: string,
    @Headers('x-device-id') deviceHeader?: string,
  ) {
    const version = Number(versionRaw);
    if (!Number.isInteger(version) || version < 0) {
      throw new BadRequestException(
        'Query parameter version (non-negative integer) is required',
      );
    }
    return this.attendanceService.softDelete(user, id, version, deviceHeader);
  }
}

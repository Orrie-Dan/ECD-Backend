import { Body, Controller, Get, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  ApiAuthErrors,
  ApiStandardClientErrors,
} from '../../common/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthUser } from '../auth/interfaces/jwt-payload.interface';
import { DevicesService } from './devices.service';
import { DeviceResponseDto } from './dto/device-response.dto';
import { RegisterDeviceDto } from './dto/register-device.dto';

@ApiTags('devices')
@ApiBearerAuth()
@Controller('devices')
export class DevicesController {
  constructor(private readonly devicesService: DevicesService) {}

  @Post('register')
  @ApiOperation({
    summary: 'Register or refresh a device',
    description:
      'Registers a client device (or updates an existing registration by deviceUuid) ' +
      'for the authenticated user. The returned `id` is the Device registry UUID used ' +
      'in `x-device-id` on mutating routes.',
  })
  @ApiCreatedResponse({ type: DeviceResponseDto })
  @ApiStandardClientErrors()
  register(@CurrentUser() user: AuthUser, @Body() dto: RegisterDeviceDto) {
    return this.devicesService.register(user, dto);
  }

  @Get('my-devices')
  @ApiOperation({
    summary: 'List my devices',
    description: 'Returns all devices registered to the authenticated user.',
  })
  @ApiOkResponse({ type: DeviceResponseDto, isArray: true })
  @ApiAuthErrors()
  myDevices(@CurrentUser() user: AuthUser) {
    return this.devicesService.findMyDevices(user);
  }
}

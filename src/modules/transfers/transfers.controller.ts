import {
  Body,
  Controller,
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
  ApiTags,
} from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { ListPaginationQueryDto } from '../../common/dto/list-pagination-query.dto';
import {
  ApiDeviceIdHeader,
  ApiNotFoundError,
  ApiOptimisticLockConflict,
  ApiStandardClientErrors,
} from '../../common/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuthUser } from '../auth/interfaces/jwt-payload.interface';
import { AcceptTransferDto } from './dto/accept-transfer.dto';
import { CancelTransferDto } from './dto/cancel-transfer.dto';
import { CreateTransferDto } from './dto/create-transfer.dto';
import {
  PaginatedTransfersResponseDto,
  TransferResponseDto,
} from './dto/transfer-response.dto';
import { TransfersService } from './transfers.service';

@ApiTags('transfers')
@ApiBearerAuth()
@Controller('transfers')
@Roles(
  UserRole.caregiver,
  UserRole.district_focal_person,
  UserRole.ncda_admin,
)
export class TransfersController {
  constructor(private readonly transfersService: TransfersService) {}

  @Post()
  @ApiOperation({
    summary: 'Initiate child transfer',
    description:
      'Creates a pending transfer. Requires childVersion for optimistic locking on the child.',
  })
  @ApiDeviceIdHeader()
  @ApiCreatedResponse({ type: TransferResponseDto })
  @ApiOptimisticLockConflict()
  @ApiStandardClientErrors()
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateTransferDto,
    @Headers('x-device-id') deviceHeader?: string,
  ) {
    return this.transfersService.create(user, {
      ...dto,
      deviceId: dto.deviceId ?? deviceHeader,
    });
  }

  @Get('incoming')
  @ApiOperation({
    summary: 'List incoming transfers',
    description:
      'Paginated transfers into centers visible to the caller (pending and historical).',
  })
  @ApiOkResponse({ type: PaginatedTransfersResponseDto })
  @ApiStandardClientErrors()
  findIncoming(
    @CurrentUser() user: AuthUser,
    @Query() query: ListPaginationQueryDto,
  ) {
    return this.transfersService.findIncoming(user, query);
  }

  @Get('outgoing')
  @ApiOperation({
    summary: 'List outgoing transfers',
    description:
      'Paginated transfers out of centers visible to the caller (pending and historical).',
  })
  @ApiOkResponse({ type: PaginatedTransfersResponseDto })
  @ApiStandardClientErrors()
  findOutgoing(
    @CurrentUser() user: AuthUser,
    @Query() query: ListPaginationQueryDto,
  ) {
    return this.transfersService.findOutgoing(user, query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get transfer by ID',
    description: 'Returns a single transfer visible in the caller scope.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: TransferResponseDto })
  @ApiNotFoundError('Transfer')
  @ApiStandardClientErrors()
  findOne(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.transfersService.findOne(user, id);
  }

  @Post(':id/accept')
  @ApiOperation({
    summary: 'Accept pending transfer',
    description:
      'Accepts a pending transfer. Requires transfer version and childVersion for CAS.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiDeviceIdHeader()
  @ApiCreatedResponse({ type: TransferResponseDto })
  @ApiNotFoundError('Transfer')
  @ApiOptimisticLockConflict()
  @ApiStandardClientErrors()
  accept(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AcceptTransferDto,
    @Headers('x-device-id') deviceHeader?: string,
  ) {
    return this.transfersService.accept(user, id, {
      ...dto,
      deviceId: dto.deviceId ?? deviceHeader,
    });
  }

  @Post(':id/cancel')
  @ApiOperation({
    summary: 'Cancel pending transfer',
    description:
      'Cancels a pending transfer. Requires transfer version and childVersion for CAS.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiDeviceIdHeader()
  @ApiCreatedResponse({ type: TransferResponseDto })
  @ApiNotFoundError('Transfer')
  @ApiOptimisticLockConflict()
  @ApiStandardClientErrors()
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelTransferDto,
    @Headers('x-device-id') deviceHeader?: string,
  ) {
    return this.transfersService.cancel(user, id, {
      ...dto,
      deviceId: dto.deviceId ?? deviceHeader,
    });
  }
}

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
import { ListCenterTransferHistoryQueryDto } from './dto/list-center-transfer-history-query.dto';
import {
  CenterTransferHistoryResponseDto,
  PaginatedTransfersResponseDto,
  TransferHistoryResponseDto,
  TransferResponseDto,
} from './dto/transfer-response.dto';
import { TransfersService } from './transfers.service';

@ApiTags('transfers')
@ApiBearerAuth()
@Controller()
@Roles(UserRole.ecd_director)
export class TransfersController {
  constructor(private readonly transfersService: TransfersService) {}

  @Post('transfers')
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

  @Get('transfers/incoming')
  @ApiOperation({
    summary: 'List incoming transfers',
    description: 'Paginated pending transfers into centers visible to the caller.',
  })
  @ApiOkResponse({ type: PaginatedTransfersResponseDto })
  @ApiStandardClientErrors()
  findIncoming(@CurrentUser() user: AuthUser, @Query() query: ListPaginationQueryDto) {
    return this.transfersService.findIncoming(user, query);
  }

  @Get('transfers/outgoing')
  @ApiOperation({
    summary: 'List outgoing transfers',
    description: 'Paginated pending transfers out of centers visible to the caller.',
  })
  @ApiOkResponse({ type: PaginatedTransfersResponseDto })
  @ApiStandardClientErrors()
  findOutgoing(@CurrentUser() user: AuthUser, @Query() query: ListPaginationQueryDto) {
    return this.transfersService.findOutgoing(user, query);
  }

  @Get('children/:id/transfer-history')
  @ApiOperation({
    summary: 'Get child transfer history',
    description:
      "Paginated transfers for a child (pending, accepted, and cancelled), newest first. Accessible when the caller can see the child's current center or any from/to center on the child's transfers.",
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Child ID' })
  @ApiOkResponse({ type: TransferHistoryResponseDto })
  @ApiNotFoundError('Child')
  @ApiStandardClientErrors()
  getChildHistory(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) childId: string,
    @Query() query: ListPaginationQueryDto,
  ) {
    return this.transfersService.getChildHistory(user, childId, query);
  }

  @Get('centers/:id/transfer-history')
  @ApiOperation({
    summary: 'Get ECD center transfer history',
    description:
      'Paginated transfers where the center is source or destination (all statuses by default), newest first. Each item includes direction (incoming|outgoing) relative to the center.',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'ECD center ID' })
  @ApiOkResponse({ type: CenterTransferHistoryResponseDto })
  @ApiNotFoundError('Center')
  @ApiStandardClientErrors()
  getCenterHistory(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) centerId: string,
    @Query() query: ListCenterTransferHistoryQueryDto,
  ) {
    return this.transfersService.getCenterHistory(user, centerId, query);
  }

  @Get('transfers/:id')
  @ApiOperation({
    summary: 'Get transfer by ID',
    description: 'Returns a single transfer visible in the caller scope.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: TransferResponseDto })
  @ApiNotFoundError('Transfer')
  @ApiStandardClientErrors()
  findOne(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.transfersService.findOne(user, id);
  }

  @Post('transfers/:id/accept')
  @ApiOperation({
    summary: 'Accept pending transfer',
    description: 'Accepts a pending transfer. Requires transfer version and childVersion for CAS.',
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

  @Post('transfers/:id/cancel')
  @ApiOperation({
    summary: 'Cancel pending transfer',
    description: 'Cancels a pending transfer. Requires transfer version and childVersion for CAS.',
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

import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { ApiStandardClientErrors } from '../../common/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuthUser } from '../auth/interfaces/jwt-payload.interface';
import { AuditLogsService } from './audit-logs.service';
import { PaginatedAuditLogsResponseDto } from './dto/audit-log-response.dto';
import { ListAuditLogsQueryDto } from './dto/list-audit-logs-query.dto';

@ApiTags('audit-logs')
@ApiBearerAuth()
@Controller('audit-logs')
export class AuditLogsController {
  constructor(private readonly auditLogsService: AuditLogsService) {}

  @Get()
  @Roles(UserRole.district_focal_person, UserRole.ncda_admin)
  @ApiOperation({
    summary: 'List audit logs',
    description: 'Paginated audit trail filtered by entity type/id, actor, action, and date range.',
  })
  @ApiOkResponse({ type: PaginatedAuditLogsResponseDto })
  @ApiStandardClientErrors()
  findAll(@CurrentUser() user: AuthUser, @Query() query: ListAuditLogsQueryDto) {
    return this.auditLogsService.findAll(user, query);
  }
}

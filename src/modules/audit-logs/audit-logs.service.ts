import { Injectable } from '@nestjs/common';
import { AuditAction, Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../auth/interfaces/jwt-payload.interface';
import {
  AuditLogResponseDto,
  PaginatedAuditLogsResponseDto,
} from './dto/audit-log-response.dto';
import { ListAuditLogsQueryDto } from './dto/list-audit-logs-query.dto';

@Injectable()
export class AuditLogsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(
    user: AuthUser,
    query: ListAuditLogsQueryDto,
  ): Promise<PaginatedAuditLogsResponseDto> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const skip = (page - 1) * pageSize;
    const where = this.buildWhere(user, query);

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        include: {
          changedBy: {
            select: { id: true, username: true, fullName: true },
          },
        },
        orderBy: [{ changedAt: 'desc' }],
        skip,
        take: pageSize,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      items: rows.map((row) => this.toDto(row)),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize) || 1,
    };
  }

  private buildWhere(
    user: AuthUser,
    query: ListAuditLogsQueryDto,
  ): Prisma.AuditLogWhereInput {
    const where: Prisma.AuditLogWhereInput = {};

    if (user.role === UserRole.district_focal_person && user.districtId) {
      where.changedBy = {
        districtId: user.districtId,
      };
    }

    if (query.entityType) {
      where.entityType = query.entityType;
    }

    if (query.entityId) {
      where.entityId = query.entityId;
    }

    if (query.action) {
      where.action = query.action;
    }

    if (query.userId) {
      where.changedById = query.userId;
    }

    if (query.from || query.to) {
      where.changedAt = {};
      if (query.from) {
        where.changedAt.gte = new Date(query.from);
      }
      if (query.to) {
        const toDate = new Date(query.to);
        toDate.setUTCHours(23, 59, 59, 999);
        where.changedAt.lte = toDate;
      }
    }

    return where;
  }

  private toDto(row: {
    id: string;
    entityType: string;
    entityId: string;
    action: AuditAction;
    changedById: string | null;
    changedAt: Date;
    oldValues: Prisma.JsonValue;
    newValues: Prisma.JsonValue;
    metadata: Prisma.JsonValue;
  }): AuditLogResponseDto {
    return {
      id: row.id,
      entityType: row.entityType,
      entityId: row.entityId,
      action: row.action,
      changedById: row.changedById,
      changedAt: row.changedAt,
      oldValues: row.oldValues,
      newValues: row.newValues,
      metadata: row.metadata,
    };
  }
}

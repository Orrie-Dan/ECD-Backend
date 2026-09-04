import { UserRole } from '../../common/domain';
import { ForbiddenException, Injectable } from '@nestjs/common';
import { AuditAction, AuditService, toAuditJson } from '../../common/audit';
import { assertDistrictAccess } from '../../common/auth/scope.util';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../auth/interfaces/jwt-payload.interface';
import { SettingResponseDto } from './dto/setting-response.dto';
import { ListSettingsQueryDto } from './dto/list-settings-query.dto';
import { UpsertSettingDto } from './dto/upsert-setting.dto';

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async findAll(user: AuthUser, query: ListSettingsQueryDto): Promise<SettingResponseDto[]> {
    const districtId = this.resolveDistrictId(user, query.districtId);

    const rows = await this.prisma.appSetting.findMany({
      where: { districtId },
      orderBy: [{ key: 'asc' }],
    });

    return rows.map((row) => this.toDto(row));
  }

  async upsert(user: AuthUser, dto: UpsertSettingDto): Promise<SettingResponseDto> {
    assertDistrictAccess(user, dto.districtId);

    const existing = await this.prisma.appSetting.findUnique({
      where: {
        districtId_key: {
          districtId: dto.districtId,
          key: dto.key,
        },
      },
    });

    const now = new Date();
    const isCreate = !existing;

    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.appSetting.upsert({
        where: {
          districtId_key: {
            districtId: dto.districtId,
            key: dto.key,
          },
        },
        create: {
          districtId: dto.districtId,
          key: dto.key,
          value: dto.value,
          updatedAt: now,
          updatedById: user.id,
        },
        update: {
          value: dto.value,
          updatedAt: now,
          updatedById: user.id,
        },
      });

      await this.audit.log({
        tx,
        entityType: 'app_setting',
        entityId: updated.id,
        action: isCreate ? AuditAction.CREATE : AuditAction.UPDATE,
        userId: user.id,
        oldValues: existing
          ? toAuditJson({
              districtId: existing.districtId,
              key: existing.key,
              value: existing.value,
            })
          : null,
        newValues: toAuditJson({
          districtId: updated.districtId,
          key: updated.key,
          value: updated.value,
        }),
        metadata: { source: 'rest' },
      });

      return updated;
    });

    return this.toDto(result);
  }

  private resolveDistrictId(user: AuthUser, queryDistrictId?: string): string {
    if (user.role === UserRole.ncda_admin) {
      if (queryDistrictId) {
        return queryDistrictId;
      }
      throw new ForbiddenException('districtId is required for ncda_admin');
    }

    if (user.role === UserRole.district_focal_person) {
      if (!user.districtId) {
        throw new ForbiddenException('District scope is required');
      }
      if (queryDistrictId && queryDistrictId !== user.districtId) {
        assertDistrictAccess(user, queryDistrictId);
      }
      return user.districtId;
    }

    throw new ForbiddenException('Invalid role for settings access');
  }

  private toDto(row: {
    id: string;
    districtId: string;
    key: string;
    value: string;
    updatedAt: Date;
    updatedById: string | null;
  }): SettingResponseDto {
    return {
      id: row.id,
      districtId: row.districtId,
      key: row.key,
      value: row.value,
      updatedAt: row.updatedAt,
      updatedById: row.updatedById,
    };
  }
}

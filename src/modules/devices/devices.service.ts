import { DeviceStatus, asDomainEnum } from '../../common/domain';
import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../auth/interfaces/jwt-payload.interface';
import { RegisterDeviceDto } from './dto/register-device.dto';

export interface DeviceResponse {
  id: string;
  deviceUuid: string;
  platform: string | null;
  appVersion: string | null;
  status: DeviceStatus;
  lastSeenAt: Date | null;
  /** Additive alias of lastSeenAt (DB column last_sync_at). */
  lastSyncAt: Date | null;
  registeredAt: Date;
}

@Injectable()
export class DevicesService {
  constructor(private readonly prisma: PrismaService) {}

  async register(user: AuthUser, dto: RegisterDeviceDto): Promise<DeviceResponse> {
    this.assertCanRegisterDevice(user);

    const existing = await this.prisma.device.findUnique({
      where: { deviceUuid: dto.deviceUuid },
    });

    if (existing && existing.userId !== user.id) {
      throw new ConflictException('This device is already registered to another user');
    }

    const now = new Date();

    if (existing) {
      const updated = await this.prisma.device.update({
        where: { id: existing.id },
        data: {
          platform: dto.platform ?? existing.platform,
          appVersion: dto.appVersion ?? existing.appVersion,
          status: DeviceStatus.active,
          lastSyncAt: now,
        },
      });

      return this.toResponse(updated);
    }

    const created = await this.prisma.device.create({
      data: {
        id: randomUUID(),
        userId: user.id,
        deviceUuid: dto.deviceUuid,
        platform: dto.platform,
        appVersion: dto.appVersion,
        status: DeviceStatus.active,
        lastSyncAt: now,
        registeredAt: now,
      },
    });

    return this.toResponse(created);
  }

  async findMyDevices(user: AuthUser): Promise<DeviceResponse[]> {
    const devices = await this.prisma.device.findMany({
      where: { userId: user.id },
      orderBy: { registeredAt: 'desc' },
    });

    return devices.map((device) => this.toResponse(device));
  }

  private assertCanRegisterDevice(user: AuthUser): void {
    if (user.status !== 'active') {
      throw new ForbiddenException('Inactive accounts cannot register devices');
    }
  }

  private toResponse(device: {
    id: string;
    deviceUuid: string;
    platform: string | null;
    appVersion: string | null;
    status: string;
    lastSyncAt: Date | null;
    registeredAt: Date;
  }): DeviceResponse {
    return {
      id: device.id,
      deviceUuid: device.deviceUuid,
      platform: device.platform,
      appVersion: device.appVersion,
      status: asDomainEnum<DeviceStatus>(device.status),
      // Schema column is last_sync_at; lastSeenAt kept for backwards compatibility.
      lastSeenAt: device.lastSyncAt,
      lastSyncAt: device.lastSyncAt,
      registeredAt: device.registeredAt,
    };
  }
}

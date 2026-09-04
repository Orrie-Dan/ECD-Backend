import { DeviceStatus } from '../../../common/domain';
import { ApiProperty } from '@nestjs/swagger';
/**
 * Swagger DTO matching DeviceResponse in devices.service.ts.
 * Controllers will reference this later; service interface unchanged.
 */
export class DeviceResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'Stable client-generated device identifier',
  })
  deviceUuid: string;

  @ApiProperty({ example: 'android', nullable: true })
  platform: string | null;

  @ApiProperty({ example: '1.2.0', nullable: true })
  appVersion: string | null;

  @ApiProperty({ enum: DeviceStatus, enumName: 'DeviceStatus' })
  status: DeviceStatus;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description:
      'Legacy alias for last sync / heartbeat. Same value as lastSyncAt (DB last_sync_at).',
  })
  lastSeenAt: Date | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'Last sync timestamp (DB last_sync_at). Additive alias of lastSeenAt.',
  })
  lastSyncAt: Date | null;

  @ApiProperty({ type: String, format: 'date-time' })
  registeredAt: Date;
}

import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { NotificationsModule } from '../notifications/notifications.module';
import { TransfersModule } from '../transfers/transfers.module';
import { SyncAccessService } from './sync-access.service';
import { SyncApplyService } from './sync-apply.service';
import { SyncController } from './sync.controller';
import { SYNC_QUEUE } from './sync.constants';
import { buildRedisConnection } from './redis.connection';
import { SyncNotificationBridgeService } from './sync-notification-bridge.service';
import { SyncProcessor } from './sync.processor';
import { SyncService } from './sync.service';

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: buildRedisConnection(config),
      }),
    }),
    BullModule.registerQueue({
      name: SYNC_QUEUE,
    }),
    NotificationsModule,
    forwardRef(() => TransfersModule),
  ],
  controllers: [SyncController],
  providers: [
    SyncService,
    SyncProcessor,
    SyncApplyService,
    SyncAccessService,
    SyncNotificationBridgeService,
  ],
  exports: [SyncService, SyncAccessService],
})
export class SyncModule {}

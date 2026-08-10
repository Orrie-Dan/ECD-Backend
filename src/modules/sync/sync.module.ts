import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TransfersModule } from '../transfers/transfers.module';
import { SyncAccessService } from './sync-access.service';
import { SyncApplyService } from './sync-apply.service';
import { SyncController } from './sync.controller';
import { SYNC_QUEUE } from './sync.constants';
import { SyncProcessor } from './sync.processor';
import { SyncService } from './sync.service';

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get<string>('REDIS_HOST', '127.0.0.1'),
          port: Number(config.get<string>('REDIS_PORT', '6379')),
        },
      }),
    }),
    BullModule.registerQueue({
      name: SYNC_QUEUE,
    }),
    forwardRef(() => TransfersModule),
  ],
  controllers: [SyncController],
  providers: [
    SyncService,
    SyncProcessor,
    SyncApplyService,
    SyncAccessService,
  ],
  exports: [SyncService, SyncAccessService],
})
export class SyncModule {}

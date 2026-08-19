import { Module, forwardRef } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { SyncModule } from '../sync/sync.module';
import { TransferLifecycleService } from './transfer-lifecycle.service';
import { TransfersController } from './transfers.controller';
import { TransfersService } from './transfers.service';

@Module({
  imports: [forwardRef(() => SyncModule), NotificationsModule],
  controllers: [TransfersController],
  providers: [TransfersService, TransferLifecycleService],
  exports: [TransfersService, TransferLifecycleService],
})
export class TransfersModule {}

import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { StedController } from './sted.controller';
import { StedService } from './sted.service';

@Module({
  imports: [NotificationsModule],
  controllers: [StedController],
  providers: [StedService],
  exports: [StedService],
})
export class StedModule {}

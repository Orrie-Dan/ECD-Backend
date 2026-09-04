import { Module } from '@nestjs/common';
import { NotificationCronService } from './notification-cron.service';
import { NotificationEventsService } from './notification-events.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationEventsService, NotificationCronService],
  exports: [NotificationsService, NotificationEventsService],
})
export class NotificationsModule {}

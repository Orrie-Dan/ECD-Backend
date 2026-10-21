import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { CentersController } from './centers.controller';
import { CentersService } from './centers.service';

@Module({
  imports: [NotificationsModule],
  controllers: [CentersController],
  providers: [CentersService],
  exports: [CentersService],
})
export class CentersModule {}

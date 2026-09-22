import { Module } from '@nestjs/common';
import { AuditModule } from '../../common/audit';
import { AuthModule } from '../auth/auth.module';
import { EmailModule } from '../email/email.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { CaregiverWorkExperiencesController } from './caregiver-work-experiences.controller';
import { CaregiverWorkExperiencesService } from './caregiver-work-experiences.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [AuthModule, EmailModule, NotificationsModule, AuditModule],
  controllers: [UsersController, CaregiverWorkExperiencesController],
  providers: [UsersService, CaregiverWorkExperiencesService],
  exports: [UsersService],
})
export class UsersModule {}

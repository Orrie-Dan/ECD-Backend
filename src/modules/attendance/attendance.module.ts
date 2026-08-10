import { Module } from '@nestjs/common';
import { SyncModule } from '../sync/sync.module';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { UniqueChildDateInBatchConstraint } from './validators/attendance.validators';

@Module({
  imports: [SyncModule],
  controllers: [AttendanceController],
  providers: [AttendanceService, UniqueChildDateInBatchConstraint],
  exports: [AttendanceService],
})
export class AttendanceModule {}

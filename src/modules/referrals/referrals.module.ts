import { Module, forwardRef } from '@nestjs/common';
import { SyncModule } from '../sync/sync.module';
import { ReferralsController } from './referrals.controller';
import { ReferralsService } from './referrals.service';

@Module({
  imports: [forwardRef(() => SyncModule)],
  controllers: [ReferralsController],
  providers: [ReferralsService],
  exports: [ReferralsService],
})
export class ReferralsModule {}

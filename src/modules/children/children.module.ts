import { Module, forwardRef } from '@nestjs/common';
import { SyncModule } from '../sync/sync.module';
import { ChildrenController } from './children.controller';
import { ChildrenService } from './children.service';

@Module({
  imports: [forwardRef(() => SyncModule)],
  controllers: [ChildrenController],
  providers: [ChildrenService],
  exports: [ChildrenService],
})
export class ChildrenModule {}

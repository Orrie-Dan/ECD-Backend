import { Module, forwardRef } from '@nestjs/common';
import { SyncModule } from '../sync/sync.module';
import { NutritionController } from './nutrition.controller';
import { NutritionService } from './nutrition.service';

@Module({
  imports: [forwardRef(() => SyncModule)],
  controllers: [NutritionController],
  providers: [NutritionService],
  exports: [NutritionService],
})
export class NutritionModule {}

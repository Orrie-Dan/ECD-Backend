import { Module } from '@nestjs/common';
import { StedController } from './sted.controller';
import { StedService } from './sted.service';

@Module({
  controllers: [StedController],
  providers: [StedService],
  exports: [StedService],
})
export class StedModule {}

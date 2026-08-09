import { Module } from '@nestjs/common';
import { ConciergeService } from './concierge.service';
import { ConciergeController } from './concierge.controller';

@Module({
  providers: [ConciergeService],
  controllers: [ConciergeController],
  exports: [ConciergeService],
})
export class ConciergeModule {}

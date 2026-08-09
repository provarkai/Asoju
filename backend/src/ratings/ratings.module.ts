import { Module } from '@nestjs/common';
import { RatingsService } from './ratings.service';
import { RatingsController } from './ratings.controller';
import { CaseAccessGuard } from '../common/guards/case-access.guard';

@Module({
  providers: [RatingsService, CaseAccessGuard],
  controllers: [RatingsController],
  exports: [RatingsService],
})
export class RatingsModule {}

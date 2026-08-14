import { Module } from '@nestjs/common';
import { PredictiveCostingService } from './predictive-costing.service';
import { PredictiveCostingController } from './predictive-costing.controller';
import { CaseAccessGuard } from '../common/guards/case-access.guard';

@Module({
  providers: [PredictiveCostingService, CaseAccessGuard],
  controllers: [PredictiveCostingController],
  exports: [PredictiveCostingService],
})
export class PredictiveCostingModule {}

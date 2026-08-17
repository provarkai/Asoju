import { Module } from '@nestjs/common';
import { ArrivalService } from './arrival.service';
import { ArrivalController } from './arrival.controller';
import { ArrivalArrangementsController } from './arrival-arrangements.controller';
import { CaseAccessGuard } from '../common/guards/case-access.guard';

@Module({
  providers: [ArrivalService, CaseAccessGuard],
  controllers: [ArrivalController, ArrivalArrangementsController],
  exports: [ArrivalService],
})
export class ArrivalModule {}

import { Module } from '@nestjs/common';
import { FxRateService } from './fx-rate.service';

@Module({
  providers: [FxRateService],
  exports: [FxRateService],
})
export class FxModule {}

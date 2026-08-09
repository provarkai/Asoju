import { Module } from '@nestjs/common';
import { RiskEngineService } from './risk-engine.service';
import { RiskEngineController } from './risk-engine.controller';
import { CaseAccessGuard } from '../common/guards/case-access.guard';

@Module({
  providers: [RiskEngineService, CaseAccessGuard],
  controllers: [RiskEngineController],
  exports: [RiskEngineService],
})
export class RiskEngineModule {}

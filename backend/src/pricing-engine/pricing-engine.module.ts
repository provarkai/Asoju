import { Module } from '@nestjs/common';
import { PricingEngineService } from './pricing-engine.service';
import { PricingAdminController, PricingEngineController } from './pricing-engine.controller';
import { CaseAccessGuard } from '../common/guards/case-access.guard';
import { ScopeModule } from '../scope/scope.module';

@Module({
  imports: [ScopeModule],
  providers: [PricingEngineService, CaseAccessGuard],
  controllers: [PricingAdminController, PricingEngineController],
  exports: [PricingEngineService],
})
export class PricingEngineModule {}

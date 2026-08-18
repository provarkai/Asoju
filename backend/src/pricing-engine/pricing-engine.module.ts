import { forwardRef, Module } from '@nestjs/common';
import { PricingEngineService } from './pricing-engine.service';
import { PricingAdminController, PricingEngineController } from './pricing-engine.controller';
import { CaseAccessGuard } from '../common/guards/case-access.guard';
import { ScopeModule } from '../scope/scope.module';

@Module({
  // forwardRef — not because PricingEngineService itself has a reverse
  // dependency (it doesn't; this only breaks a module-file require
  // cycle): ScopeModule now imports CommerceModule (for ScopeController's
  // post-confirm autoQuoteIfEligible call — see scope.module.ts), and
  // CommerceModule imports this module, so a plain `imports: [ScopeModule]`
  // here closes a 3-file require loop (scope.module.ts ->
  // commerce.module.ts -> pricing-engine.module.ts -> scope.module.ts)
  // and ScopeModule can come back `undefined` here depending on load
  // order. No change needed in PricingEngineService's own constructor —
  // this is purely a module-graph fix.
  imports: [forwardRef(() => ScopeModule)],
  providers: [PricingEngineService, CaseAccessGuard],
  controllers: [PricingAdminController, PricingEngineController],
  exports: [PricingEngineService],
})
export class PricingEngineModule {}

import { forwardRef, Module } from '@nestjs/common';
import { ScopeService } from './scope.service';
import { ScopeController } from './scope.controller';
import { CaseAccessGuard } from '../common/guards/case-access.guard';
import { CommerceModule } from '../commerce/commerce.module';

@Module({
  // forwardRef — CommerceModule already imports ScopeModule (quote
  // creation checks scope confirmation), so this reverse import would
  // otherwise be circular. docs/AUTOMATION_PRICING_ENGINE_SCOPE.md
  // Phase 4 — ScopeController injects CommerceService to call
  // autoQuoteIfEligible() right after confirm() succeeds. Deliberately
  // wired at the controller, not inside ScopeService itself — keeps this
  // the only forwardRef edge in the graph instead of a multi-service
  // tangle (PricingEngineService still depends on ScopeService directly,
  // with no reverse edge, exactly as before this feature existed).
  imports: [forwardRef(() => CommerceModule)],
  providers: [ScopeService, CaseAccessGuard],
  controllers: [ScopeController],
  exports: [ScopeService],
})
export class ScopeModule {}

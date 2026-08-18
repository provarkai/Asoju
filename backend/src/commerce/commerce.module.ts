import { forwardRef, Module } from '@nestjs/common';
import { CommerceService } from './commerce.service';
import { CommerceController } from './commerce.controller';
import { PaymentExpirySchedulerService } from './payment-expiry-scheduler.service';
import { PaymentVerificationSchedulerService } from './payment-verification-scheduler.service';
import { QuoteExpirySchedulerService } from './quote-expiry-scheduler.service';
import { CasesModule } from '../cases/cases.module';
import { CaseAccessGuard } from '../common/guards/case-access.guard';
import { PaymentsModule } from '../payments/payments.module';
import { ConciergeModule } from '../concierge/concierge.module';
import { ScopeModule } from '../scope/scope.module';
import { IdempotencyModule } from '../common/idempotency/idempotency.module';
import { PricingEngineModule } from '../pricing-engine/pricing-engine.module';
import { FxModule } from '../fx/fx.module';

@Module({
  // MembershipService (discount/SC application on quotes) comes in via
  // ConciergeModule's exports, already imported below for the
  // subscription-invoice webhook routing. ScopeService gates quote
  // creation on a confirmed scope existing — see CommerceService.
  // PricingEngineModule — docs/AUTOMATION_PRICING_ENGINE_SCOPE.md Phase 4
  // — CommerceService.autoQuoteIfEligible calls PricingEngineService
  // directly rather than duplicating its calculation. ScopeModule is
  // forwardRef()'d — see that module's own comment on the reverse import
  // (ScopeController calling into CommerceService after a confirm).
  imports: [CasesModule, PaymentsModule, ConciergeModule, forwardRef(() => ScopeModule), IdempotencyModule, PricingEngineModule, FxModule],
  providers: [
    CommerceService,
    CaseAccessGuard,
    PaymentExpirySchedulerService,
    PaymentVerificationSchedulerService,
    QuoteExpirySchedulerService,
  ],
  controllers: [CommerceController],
  exports: [CommerceService],
})
export class CommerceModule {}

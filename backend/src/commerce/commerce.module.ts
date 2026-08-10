import { Module } from '@nestjs/common';
import { CommerceService } from './commerce.service';
import { CommerceController } from './commerce.controller';
import { PaymentExpirySchedulerService } from './payment-expiry-scheduler.service';
import { QuoteExpirySchedulerService } from './quote-expiry-scheduler.service';
import { CasesModule } from '../cases/cases.module';
import { CaseAccessGuard } from '../common/guards/case-access.guard';
import { PaymentsModule } from '../payments/payments.module';
import { ConciergeModule } from '../concierge/concierge.module';
import { ScopeModule } from '../scope/scope.module';

@Module({
  // MembershipService (discount/SC application on quotes) comes in via
  // ConciergeModule's exports, already imported below for the
  // subscription-invoice webhook routing. ScopeService gates quote
  // creation on a confirmed scope existing — see CommerceService.
  imports: [CasesModule, PaymentsModule, ConciergeModule, ScopeModule],
  providers: [CommerceService, CaseAccessGuard, PaymentExpirySchedulerService, QuoteExpirySchedulerService],
  controllers: [CommerceController],
  exports: [CommerceService],
})
export class CommerceModule {}

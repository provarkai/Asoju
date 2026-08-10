import { Module } from '@nestjs/common';
import { ConciergeService } from './concierge.service';
import { ConciergeController } from './concierge.controller';
import { SubscriptionBillingService } from './subscription-billing.service';
import { SubscriptionBillingSchedulerService } from './subscription-billing-scheduler.service';
import { ScLedgerService } from './sc-ledger.service';
import { MembershipService } from './membership.service';
import { PlanConfigService } from './plan-config.service';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [PaymentsModule],
  providers: [
    ConciergeService,
    SubscriptionBillingService,
    SubscriptionBillingSchedulerService,
    ScLedgerService,
    MembershipService,
    PlanConfigService,
  ],
  controllers: [ConciergeController],
  exports: [ConciergeService, SubscriptionBillingService, ScLedgerService, MembershipService, PlanConfigService],
})
export class ConciergeModule {}

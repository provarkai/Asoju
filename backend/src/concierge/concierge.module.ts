import { Module } from '@nestjs/common';
import { ConciergeService } from './concierge.service';
import { ConciergeController } from './concierge.controller';
import { SubscriptionBillingService } from './subscription-billing.service';
import { SubscriptionBillingSchedulerService } from './subscription-billing-scheduler.service';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [PaymentsModule],
  providers: [ConciergeService, SubscriptionBillingService, SubscriptionBillingSchedulerService],
  controllers: [ConciergeController],
  exports: [ConciergeService, SubscriptionBillingService],
})
export class ConciergeModule {}

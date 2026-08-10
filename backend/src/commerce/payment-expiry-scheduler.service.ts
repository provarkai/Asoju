import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CommerceService } from './commerce.service';

/** Same pattern as SubscriptionBillingSchedulerService / RecurringSchedulerService
 * — the cron entry point; POST /admin/payments/run-expiry-sweep triggers the
 * same sweep on demand for ops/testing without waiting on the clock. Hourly
 * rather than daily — a payment window is hours, not days. */
@Injectable()
export class PaymentExpirySchedulerService {
  private readonly logger = new Logger(PaymentExpirySchedulerService.name);

  constructor(private readonly commerce: CommerceService) {}

  @Cron(CronExpression.EVERY_HOUR)
  async handleCron() {
    const result = await this.commerce.runPaymentExpirySweep();
    if (result.expired > 0) {
      this.logger.log(`Payment expiry sweep: expired=${result.expired}`);
    }
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CommerceService } from './commerce.service';

/** Same pattern as PaymentExpirySchedulerService / SubscriptionBillingSchedulerService
 * — the cron entry point; POST /admin/quotes/run-expiry-sweep triggers the
 * same sweep on demand for ops/testing without waiting on the clock. */
@Injectable()
export class QuoteExpirySchedulerService {
  private readonly logger = new Logger(QuoteExpirySchedulerService.name);

  constructor(private readonly commerce: CommerceService) {}

  @Cron(CronExpression.EVERY_HOUR)
  async handleCron() {
    const result = await this.commerce.runQuoteExpirySweep();
    if (result.expired > 0) {
      this.logger.log(`Quote expiry sweep: expired=${result.expired}`);
    }
  }
}

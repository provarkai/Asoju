import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SubscriptionBillingService } from './subscription-billing.service';

/** Same pattern as RecurringSchedulerService for recurring services — the
 * cron entry point; POST /admin/subscriptions/run-billing triggers the same
 * sweep on demand for testing without waiting on the clock. */
@Injectable()
export class SubscriptionBillingSchedulerService {
  private readonly logger = new Logger(SubscriptionBillingSchedulerService.name);

  constructor(private readonly billing: SubscriptionBillingService) {}

  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async handleCron() {
    const result = await this.billing.runBillingSweep();
    this.logger.log(`Subscription billing sweep: billed=${result.billed} lapsed=${result.lapsed}`);
  }
}

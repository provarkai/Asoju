import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CommerceService } from './commerce.service';

/** Same pattern as PaymentExpirySchedulerService — the cron entry point;
 * POST /admin/payments/run-verification-sweep triggers the same sweep on
 * demand for ops/testing. Every 5 minutes rather than hourly: this exists
 * specifically to catch a webhook that's late, so it should notice sooner
 * than the payment-expiry window (hours) would. */
@Injectable()
export class PaymentVerificationSchedulerService {
  private readonly logger = new Logger(PaymentVerificationSchedulerService.name);

  constructor(private readonly commerce: CommerceService) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async handleCron() {
    const result = await this.commerce.runPaymentVerificationSweep();
    if (result.processing > 0 || result.paid > 0 || result.failed > 0) {
      this.logger.log(
        `Payment verification sweep: checked=${result.checked} processing=${result.processing} paid=${result.paid} failed=${result.failed}`,
      );
    }
  }
}

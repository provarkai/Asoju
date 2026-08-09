import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { RecurringService } from './recurring.service';

/** The actual cron trigger — kept separate from RecurringService so the
 * business logic is unit-testable/callable without a scheduler attached. */
@Injectable()
export class RecurringSchedulerService {
  private readonly logger = new Logger(RecurringSchedulerService.name);

  constructor(private readonly recurringService: RecurringService) {}

  @Cron(CronExpression.EVERY_DAY_AT_1AM)
  async handleCron() {
    const { processed } = await this.recurringService.processDueSchedules();
    if (processed > 0) {
      this.logger.log(`Recurring schedule sweep spawned ${processed} case(s)`);
    }
  }
}

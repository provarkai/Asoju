import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AgentTieringService } from './agent-tiering.service';

/** Same pattern as SubscriptionBillingSchedulerService — the cron entry
 * point; POST /admin/agent-tiering/run triggers the same sweep on demand
 * for testing without waiting on the clock. Staggered to 4am so it doesn't
 * collide with the 1am recurring-schedule sweep or the 2am billing sweep. */
@Injectable()
export class AgentTieringSchedulerService {
  private readonly logger = new Logger(AgentTieringSchedulerService.name);

  constructor(private readonly tiering: AgentTieringService) {}

  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async handleCron() {
    await this.tiering.recomputeAllTiers();
  }
}

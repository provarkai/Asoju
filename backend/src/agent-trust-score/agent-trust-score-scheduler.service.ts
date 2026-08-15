import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AgentTrustScoreService } from './agent-trust-score.service';

/** Same on-demand-sweep pattern as AgentTieringSchedulerService — staggered
 * to 4:30am so it doesn't collide with the 4am tiering sweep, the 2am
 * billing sweep, or the 1am recurring-schedule sweep. */
@Injectable()
export class AgentTrustScoreSchedulerService {
  private readonly logger = new Logger(AgentTrustScoreSchedulerService.name);

  constructor(private readonly trustScore: AgentTrustScoreService) {}

  @Cron('0 30 4 * * *')
  async handleCron() {
    await this.trustScore.recomputeAllTrustScores();
  }
}

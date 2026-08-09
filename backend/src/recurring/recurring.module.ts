import { Module } from '@nestjs/common';
import { RecurringService } from './recurring.service';
import { RecurringSchedulerService } from './recurring-scheduler.service';
import { RecurringController } from './recurring.controller';
import { CasesModule } from '../cases/cases.module';
import { CaseAccessGuard } from '../common/guards/case-access.guard';

@Module({
  imports: [CasesModule],
  providers: [RecurringService, RecurringSchedulerService, CaseAccessGuard],
  controllers: [RecurringController],
  exports: [RecurringService],
})
export class RecurringModule {}

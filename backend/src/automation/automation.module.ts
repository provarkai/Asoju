import { Module } from '@nestjs/common';
import { AutomationEligibilityService } from './automation-eligibility.service';
import { AutomationAdminService } from './automation-admin.service';
import { AutomationAdminController } from './automation.controller';
import { EscalationModule } from '../escalation/escalation.module';

@Module({
  imports: [EscalationModule],
  providers: [AutomationEligibilityService, AutomationAdminService],
  controllers: [AutomationAdminController],
  exports: [AutomationEligibilityService],
})
export class AutomationModule {}

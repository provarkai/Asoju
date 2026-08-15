import { Module } from '@nestjs/common';
import { EscalationService } from './escalation.service';
import { EscalationController } from './escalation.controller';
import { CaseAccessGuard } from '../common/guards/case-access.guard';

@Module({
  // PrismaService and AuditService come in via their @Global modules
  // (PrismaModule, AuditModule) — no explicit import needed, same
  // convention as every other feature module in this codebase.
  providers: [EscalationService, CaseAccessGuard],
  controllers: [EscalationController],
  exports: [EscalationService],
})
export class EscalationModule {}

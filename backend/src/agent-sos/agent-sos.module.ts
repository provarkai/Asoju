import { Module } from '@nestjs/common';
import { CasesModule } from '../cases/cases.module';
import { AgentSosService } from './agent-sos.service';
import { AgentSosController } from './agent-sos.controller';

// NotificationsModule is @Global() (see notifications.module.ts) — no
// explicit import needed for NotificationsService, same as
// assignments.module.ts/cases.module.ts.
@Module({
  imports: [CasesModule],
  providers: [AgentSosService],
  controllers: [AgentSosController],
  exports: [AgentSosService],
})
export class AgentSosModule {}

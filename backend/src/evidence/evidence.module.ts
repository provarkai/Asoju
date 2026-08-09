import { Module } from '@nestjs/common';
import { EvidenceService } from './evidence.service';
import { EvidenceController } from './evidence.controller';
import { CasesModule } from '../cases/cases.module';
import { CaseAccessGuard } from '../common/guards/case-access.guard';
import { RiskEngineModule } from '../risk/risk-engine.module';

@Module({
  imports: [CasesModule, RiskEngineModule],
  providers: [EvidenceService, CaseAccessGuard],
  controllers: [EvidenceController],
  exports: [EvidenceService],
})
export class EvidenceModule {}

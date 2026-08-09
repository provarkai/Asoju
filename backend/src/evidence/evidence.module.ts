import { Module } from '@nestjs/common';
import { EvidenceService } from './evidence.service';
import { EvidenceController } from './evidence.controller';
import { CasesModule } from '../cases/cases.module';
import { CaseAccessGuard } from '../common/guards/case-access.guard';

@Module({
  imports: [CasesModule],
  providers: [EvidenceService, CaseAccessGuard],
  controllers: [EvidenceController],
  exports: [EvidenceService],
})
export class EvidenceModule {}

import { Module } from '@nestjs/common';
import { CasesService } from './cases.service';
import { CasesController } from './cases.controller';
import { CaseAccessGuard } from '../common/guards/case-access.guard';

@Module({
  providers: [CasesService, CaseAccessGuard],
  controllers: [CasesController],
  exports: [CasesService],
})
export class CasesModule {}

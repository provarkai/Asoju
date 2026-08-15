import { Module } from '@nestjs/common';
import { CaseReportPdfService } from './case-report-pdf.service';
import { CaseReportPdfController } from './case-report-pdf.controller';
import { CaseAccessGuard } from '../common/guards/case-access.guard';

@Module({
  providers: [CaseReportPdfService, CaseAccessGuard],
  controllers: [CaseReportPdfController],
  exports: [CaseReportPdfService],
})
export class CaseReportPdfModule {}

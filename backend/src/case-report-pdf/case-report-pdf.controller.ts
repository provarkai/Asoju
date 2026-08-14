import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CaseAccessGuard } from '../common/guards/case-access.guard';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { CaseReportPdfService } from './case-report-pdf.service';

// No @Roles — same shape as CasesController's GET cases/:id: any
// authenticated role may reach this route, CaseAccessGuard is the real
// check (customer who owns the case, the assigned field agent/provider,
// an explicit staff collaborator, or ADMIN/SUPER_ADMIN).
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class CaseReportPdfController {
  constructor(private readonly reportPdf: CaseReportPdfService) {}

  @UseGuards(CaseAccessGuard)
  @Get('cases/:caseId/report/pdf')
  getReportPdf(@CurrentUser() user: AuthenticatedUser, @Param('caseId') caseId: string) {
    return this.reportPdf.getReportPdfUrl(user, caseId);
  }
}

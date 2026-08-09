import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CaseAccessGuard } from '../common/guards/case-access.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { EvidenceService } from './evidence.service';
import { CreateEvidenceDto } from './dto/create-evidence.dto';
import { PerformQcDto } from './dto/perform-qc.dto';

const FIELD_ROLES = [Role.FIELD_AGENT, Role.PROVIDER];
const QC_ROLES = [Role.QUALITY_CONTROL, Role.ADMIN, Role.SUPER_ADMIN];

@UseGuards(JwtAuthGuard, RolesGuard, CaseAccessGuard)
@Controller('cases/:caseId')
export class EvidenceController {
  constructor(private readonly evidenceService: EvidenceService) {}

  @Roles(...FIELD_ROLES)
  @Post('evidence')
  submitEvidence(
    @CurrentUser() user: AuthenticatedUser,
    @Param('caseId') caseId: string,
    @Body() dto: CreateEvidenceDto,
  ) {
    return this.evidenceService.submitEvidence(user, caseId, dto);
  }

  @Roles(...FIELD_ROLES)
  @Post('evidence/complete')
  completeFieldwork(@CurrentUser() user: AuthenticatedUser, @Param('caseId') caseId: string) {
    return this.evidenceService.completeFieldwork(user, caseId);
  }

  @Roles(...QC_ROLES)
  @Post('qc')
  performQc(
    @CurrentUser() user: AuthenticatedUser,
    @Param('caseId') caseId: string,
    @Body() dto: PerformQcDto,
  ) {
    return this.evidenceService.performQc(user, caseId, dto);
  }
}

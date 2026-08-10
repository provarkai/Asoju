import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { AuditService } from './audit.service';
import { SearchAuditEventsDto } from './dto/search-audit-events.dto';

/** Admin Console & Platform Admin Architecture v1.0 Section 26 "Audit
 * Log" (P0 MVP screen A20) / API Specification Section 28 — "Ordinary
 * clients must not create, modify or delete audit events directly."
 * Read-only by design: AuditService exposes no mutation beyond record(),
 * and nothing here calls it. Admin/SuperAdmin only — this is the
 * cross-case, cross-actor view; case-scoped staff already see their own
 * case's audit trail via the case detail endpoint (CasesService includes
 * it there for anyone with case access), which doesn't require this
 * broader, unrestricted-by-case-membership permission. */
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.SUPER_ADMIN)
@Controller('admin/audit-events')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  search(@Query() query: SearchAuditEventsDto) {
    return this.auditService.search(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.auditService.findById(id);
  }
}

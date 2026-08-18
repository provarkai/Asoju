import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CaseAccessGuard } from '../common/guards/case-access.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { ScopeService } from './scope.service';
import { CreateScopeDto } from './dto/create-scope.dto';
import { CommerceService } from '../commerce/commerce.service';

const SCOPE_STAFF_ROLES = [Role.CASE_MANAGER, Role.ADMIN, Role.SUPER_ADMIN];

@UseGuards(JwtAuthGuard, RolesGuard, CaseAccessGuard)
@Controller('cases/:caseId/scope')
export class ScopeController {
  // CommerceService only for autoQuoteIfEligible after a confirm — kept
  // out of ScopeService itself (which CommerceService already depends on
  // to check scope confirmation) so the module graph only needs one
  // forwardRef edge (ScopeModule -> CommerceModule) instead of a tangled
  // multi-service cycle. See scope.module.ts's own comment.
  constructor(
    private readonly scopeService: ScopeService,
    private readonly commerce: CommerceService,
  ) {}

  /** No @Roles — anyone with case access (customer, staff, assigned
   * field actor) can see what was actually agreed to. */
  @Get()
  getLatest(@Param('caseId') caseId: string) {
    return this.scopeService.getLatest(caseId);
  }

  @Get('versions')
  listVersions(@Param('caseId') caseId: string) {
    return this.scopeService.listVersions(caseId);
  }

  @Roles(...SCOPE_STAFF_ROLES)
  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('caseId') caseId: string,
    @Body() dto: CreateScopeDto,
  ) {
    return this.scopeService.createOrRevise(user, caseId, dto);
  }

  // docs/AUTOMATION_PRICING_ENGINE_SCOPE.md Phase 4 — the instant scope
  // is confirmed is exactly when a priced case can skip straight to a
  // quote instead of waiting on a staff member to type one.
  // autoQuoteIfEligible never throws (see its own comment) — a pricing
  // problem must never make scope confirmation itself fail. Its return
  // value is deliberately ignored: the response here is always shaped as
  // just the confirmed scope, exactly as before this feature existed —
  // a caller checks GET .../quotes to see whether one was generated.
  @Roles(Role.CUSTOMER)
  @HttpCode(HttpStatus.OK)
  @Post('confirm')
  async confirm(@CurrentUser() user: AuthenticatedUser, @Param('caseId') caseId: string) {
    const confirmed = await this.scopeService.confirm(user, caseId);
    await this.commerce.autoQuoteIfEligible(caseId);
    return confirmed;
  }
}

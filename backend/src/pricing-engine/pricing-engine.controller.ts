import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CaseAccessGuard } from '../common/guards/case-access.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { PricingEngineService } from './pricing-engine.service';
import { CreatePriceBookDto } from './dto/create-price-book.dto';
import { CreatePriceRuleDto } from './dto/create-price-rule.dto';
import { CreateMultiplierRuleDto } from './dto/create-multiplier-rule.dto';

// Same admin/pricing-configuration authority as membership-plan config
// (concierge.controller.ts's FINANCE_ROLES) — this is the same class of
// decision (what ASOJU charges), just a different table.
const FINANCE_ROLES = [Role.FINANCE, Role.ADMIN, Role.SUPER_ADMIN];

// Same staff who already see the (advisory) regional-pricing hint and
// predicted cost — this calculator is their authoritative successor.
const STAFF_QUOTE_ROLES = [Role.CASE_MANAGER, Role.FINANCE, Role.ADMIN, Role.SUPER_ADMIN];

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin/pricing')
export class PricingAdminController {
  constructor(private readonly pricingEngine: PricingEngineService) {}

  @Roles(...FINANCE_ROLES)
  @Post('price-books')
  createPriceBook(@Body() dto: CreatePriceBookDto) {
    return this.pricingEngine.createPriceBook(dto);
  }

  @Roles(...FINANCE_ROLES)
  @Get('price-books')
  listPriceBooks() {
    return this.pricingEngine.listPriceBooks();
  }

  @Roles(...FINANCE_ROLES)
  @Post('price-books/:id/activate')
  activatePriceBook(@Param('id') id: string) {
    return this.pricingEngine.activatePriceBook(id);
  }

  @Roles(...FINANCE_ROLES)
  @Post('price-books/:id/price-rules')
  addPriceRule(@Param('id') id: string, @Body() dto: CreatePriceRuleDto) {
    return this.pricingEngine.addPriceRule(id, dto);
  }

  @Roles(...FINANCE_ROLES)
  @Get('price-books/:id/price-rules')
  listPriceRules(@Param('id') id: string) {
    return this.pricingEngine.listPriceRules(id);
  }

  @Roles(...FINANCE_ROLES)
  @Post('price-books/:id/multiplier-rules')
  addMultiplierRule(@Param('id') id: string, @Body() dto: CreateMultiplierRuleDto) {
    return this.pricingEngine.addMultiplierRule(id, dto);
  }

  @Roles(...FINANCE_ROLES)
  @Get('price-books/:id/multiplier-rules')
  listMultiplierRules(@Param('id') id: string) {
    return this.pricingEngine.listMultiplierRules(id);
  }
}

@UseGuards(JwtAuthGuard, RolesGuard, CaseAccessGuard)
@Roles(...STAFF_QUOTE_ROLES)
@Controller()
export class PricingEngineController {
  constructor(private readonly pricingEngine: PricingEngineService) {}

  /** docs/AUTOMATION_PRICING_ENGINE_SCOPE.md Phase 1 — a preview, not a
   * mutation. Staff still submit the resulting line (or their own number)
   * through the existing POST /cases/:caseId/quotes. */
  @Get('cases/:caseId/pricing-preview')
  calculate(@Param('caseId') caseId: string) {
    return this.pricingEngine.calculateServiceFeeLine(caseId);
  }
}

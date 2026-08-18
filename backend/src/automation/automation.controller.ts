import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { AutomationAdminService } from './automation-admin.service';
import { CreateAutomationCapabilityDto } from './dto/create-automation-capability.dto';
import { UpdateAutomationCapabilityDto } from './dto/update-automation-capability.dto';
import { CreateAutomationRuleDto } from './dto/create-automation-rule.dto';

// Same admin/pricing-configuration authority as the pricing engine's own
// admin controller (pricing-engine.controller.ts's FINANCE_ROLES) — this
// is the same class of decision (what's allowed to run without a human),
// arguably higher-stakes, same gate.
const FINANCE_ROLES = [Role.FINANCE, Role.ADMIN, Role.SUPER_ADMIN];

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...FINANCE_ROLES)
@Controller('admin/automation')
export class AutomationAdminController {
  constructor(private readonly automationAdmin: AutomationAdminService) {}

  @Post('capabilities')
  createCapability(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateAutomationCapabilityDto) {
    return this.automationAdmin.createCapability(user, dto.serviceType, dto.enabled);
  }

  @Get('capabilities')
  listCapabilities() {
    return this.automationAdmin.listCapabilities();
  }

  /** The kill switch. `serviceType` arrives as a raw route-param string —
   * AutomationAdminService validates it's a real ServiceType value before
   * querying, same "reject before it reaches Prisma" reasoning as
   * assertValidConfigShape. */
  @Patch('capabilities/:serviceType')
  setEnabled(
    @CurrentUser() user: AuthenticatedUser,
    @Param('serviceType') serviceType: string,
    @Body() dto: UpdateAutomationCapabilityDto,
  ) {
    return this.automationAdmin.setEnabled(user, serviceType, dto.enabled);
  }

  @Post('capabilities/:id/rules')
  addRule(@CurrentUser() user: AuthenticatedUser, @Param('id') capabilityId: string, @Body() dto: CreateAutomationRuleDto) {
    return this.automationAdmin.addRule(user, capabilityId, dto.kind, dto.config, dto.sortOrder);
  }

  @Get('capabilities/:id/rules')
  listRules(@Param('id') capabilityId: string) {
    return this.automationAdmin.listRules(capabilityId);
  }

  @Post('rules/:id/remove')
  removeRule(@CurrentUser() user: AuthenticatedUser, @Param('id') ruleId: string) {
    return this.automationAdmin.removeRule(user, ruleId);
  }
}

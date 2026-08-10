import { BadRequestException, Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { MembershipPlan, Role } from '@prisma/client';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { ConciergeService } from './concierge.service';
import { SubscriptionBillingService } from './subscription-billing.service';
import { ScLedgerService } from './sc-ledger.service';
import { PlanConfigService } from './plan-config.service';
import { AssignRmDto } from './dto/assign-rm.dto';
import { SubscribeDto } from './dto/subscribe.dto';
import { ScAdjustmentDto } from './dto/sc-adjustment.dto';
import { UpdatePlanConfigDto } from './dto/update-plan-config.dto';

const FINANCE_ROLES = [Role.FINANCE, Role.ADMIN, Role.SUPER_ADMIN];

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class ConciergeController {
  constructor(
    private readonly conciergeService: ConciergeService,
    private readonly billingService: SubscriptionBillingService,
    private readonly scLedgerService: ScLedgerService,
    private readonly planConfigService: PlanConfigService,
  ) {}

  // -- Plan pricing (P0 UX Spec "Admin Screen — Pricing Configuration") ---

  /** Broadly accessible to any logged-in user — the customer-facing plan
   * picker needs live pricing too, and there's no commercial reason to
   * hide current list pricing from someone who's already authenticated. */
  @Get('membership-plans')
  listPlanConfigs() {
    return this.planConfigService.listConfigs();
  }

  @Roles(...FINANCE_ROLES)
  @Patch('admin/membership-plans/:plan')
  updatePlanConfig(
    @CurrentUser() user: AuthenticatedUser,
    @Param('plan') plan: string,
    @Body() dto: UpdatePlanConfigDto,
  ) {
    if (!Object.values(MembershipPlan).includes(plan as MembershipPlan)) {
      throw new BadRequestException(`Unknown plan ${plan}`);
    }
    return this.planConfigService.updateConfig(user, plan as MembershipPlan, dto);
  }

  // -- Customer self-service --------------------------------------------

  @Roles(Role.CUSTOMER)
  @Post('me/subscription')
  subscribe(@CurrentUser() user: AuthenticatedUser, @Body() dto: SubscribeDto) {
    return this.conciergeService.subscribe(user, dto.plan);
  }

  @Roles(Role.CUSTOMER)
  @Get('me/subscription')
  getMySubscription(@CurrentUser() user: AuthenticatedUser) {
    return this.conciergeService.getMySubscription(user);
  }

  /** P0 UX Spec "Customer Screen — Membership": SC credit/debit history
   * behind the plan's balance summary. */
  @Roles(Role.CUSTOMER)
  @Get('me/subscription/sc-ledger')
  getMyScLedger(@CurrentUser() user: AuthenticatedUser) {
    return this.conciergeService.getMyScLedger(user);
  }

  @Roles(Role.CUSTOMER)
  @HttpCode(HttpStatus.OK)
  @Post('me/subscription/cancel')
  cancelSubscription(@CurrentUser() user: AuthenticatedUser) {
    return this.conciergeService.cancelSubscription(user);
  }

  /** Section 12 P2 "full subscription engine" — the customer's own billing
   * history (one row per period, once billed). */
  @Roles(Role.CUSTOMER)
  @Get('me/subscription/invoices')
  async getMyInvoices(@CurrentUser() user: AuthenticatedUser) {
    const customer = await this.conciergeService.requireCustomerForInvoices(user);
    return this.billingService.listInvoicesForCustomer(customer.id);
  }

  // -- Admin: subscription billing -----------------------------------------

  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  @Post('admin/subscriptions/run-billing')
  runBillingSweep() {
    return this.billingService.runBillingSweep();
  }

  // -- Finance: SC ledger (P0 UX Spec "Finance Screen — SC Ledger") -------

  @Roles(...FINANCE_ROLES)
  @Get('admin/subscriptions/:id/sc-ledger')
  getScLedger(@Param('id') subscriptionId: string) {
    return this.scLedgerService.listForSubscription(subscriptionId);
  }

  /** "No manual balance edits without an auditable adjustment" — the one
   * way a human can move a customer's SC balance directly, and only with
   * a reason (enforced by ScAdjustmentDto/ScLedgerService.adjust). */
  @Roles(...FINANCE_ROLES)
  @HttpCode(HttpStatus.OK)
  @Post('admin/subscriptions/:id/sc-adjustment')
  adjustScBalance(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') subscriptionId: string,
    @Body() dto: ScAdjustmentDto,
  ) {
    return this.scLedgerService.adjust(subscriptionId, dto.amountUsd, dto.reason, user.id);
  }

  // -- Admin: assigning Relationship Managers -----------------------------

  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @Get('concierge/customers')
  listCustomers() {
    return this.conciergeService.listCustomers();
  }

  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @Get('concierge/relationship-managers')
  listRelationshipManagers() {
    return this.conciergeService.listRelationshipManagers();
  }

  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @Patch('concierge/customers/:customerId/rm')
  assignRm(
    @CurrentUser() user: AuthenticatedUser,
    @Param('customerId') customerId: string,
    @Body() dto: AssignRmDto,
  ) {
    return this.conciergeService.assignRm(user, customerId, dto.rmUserId);
  }

  // -- Relationship Manager: own portfolio --------------------------------

  @Roles(Role.RELATIONSHIP_MANAGER, Role.ADMIN, Role.SUPER_ADMIN)
  @Get('concierge/portfolio')
  listPortfolio(@CurrentUser() user: AuthenticatedUser) {
    return this.conciergeService.listPortfolio(user);
  }
}

import { BadRequestException, Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, UseGuards, Req } from '@nestjs/common';
import { Role, RefundRequestStatus } from '@prisma/client';
import { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CaseAccessGuard } from '../common/guards/case-access.guard';
import { PaystackWebhookGuard } from '../payments/paystack-webhook.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { CommerceService, CASE_INVOICE_REFERENCE_PREFIX } from './commerce.service';
import { SubscriptionBillingService, SUBSCRIPTION_INVOICE_REFERENCE_PREFIX } from '../concierge/subscription-billing.service';
import { CreateQuoteDto } from './dto/create-quote.dto';
import { RefundPaymentDto } from './dto/refund-payment.dto';
import { ResolveReconciliationDto } from './dto/resolve-reconciliation.dto';
import { RecordDirectCostDto } from './dto/record-direct-cost.dto';
import { DecideRefundRequestDto } from './dto/decide-refund-request.dto';

const STAFF_QUOTE_ROLES = [Role.CASE_MANAGER, Role.FINANCE, Role.ADMIN, Role.SUPER_ADMIN];
const FINANCE_ROLES = [Role.FINANCE, Role.ADMIN, Role.SUPER_ADMIN];

interface PaystackChargeEvent {
  event: string;
  data: { reference: string; amount: number; status: string; gateway_response?: string };
}

@Controller()
export class CommerceController {
  constructor(
    private readonly commerceService: CommerceService,
    private readonly subscriptionBilling: SubscriptionBillingService,
  ) {}

  @UseGuards(JwtAuthGuard, RolesGuard, CaseAccessGuard)
  @Roles(...STAFF_QUOTE_ROLES)
  @Post('cases/:caseId/quotes')
  createQuote(
    @CurrentUser() user: AuthenticatedUser,
    @Param('caseId') caseId: string,
    @Body() dto: CreateQuoteDto,
  ) {
    return this.commerceService.createQuote(user, caseId, dto);
  }

  /** Platform Expansion PRD §2.2/§2.3 — what the regional matrix
   * suggests for this case's service fee, and whether SC will be
   * offered, before staff build the actual quote lines. */
  @UseGuards(JwtAuthGuard, RolesGuard, CaseAccessGuard)
  @Roles(...STAFF_QUOTE_ROLES)
  @Get('cases/:caseId/regional-pricing-hint')
  getRegionalPricingHint(@Param('caseId') caseId: string) {
    return this.commerceService.getRegionalPricingHint(caseId);
  }

  /** P0 Tech Platform §33 "Financial & Analytics Requirements" —
   * Finance-only, case-scoped. Never exposed on the general case-detail
   * response every viewer (including the customer) hits. */
  @UseGuards(JwtAuthGuard, RolesGuard, CaseAccessGuard)
  @Roles(...FINANCE_ROLES)
  @Post('cases/:caseId/direct-costs')
  recordDirectCost(
    @CurrentUser() user: AuthenticatedUser,
    @Param('caseId') caseId: string,
    @Body() dto: RecordDirectCostDto,
  ) {
    return this.commerceService.recordDirectCost(user, caseId, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard, CaseAccessGuard)
  @Roles(...FINANCE_ROLES)
  @Get('cases/:caseId/direct-costs')
  listDirectCosts(@Param('caseId') caseId: string) {
    return this.commerceService.listDirectCosts(caseId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.CUSTOMER)
  @Post('quotes/:id/accept')
  acceptQuote(@CurrentUser() user: AuthenticatedUser, @Param('id') quoteId: string) {
    return this.commerceService.acceptQuote(user, quoteId);
  }

  /** Section 12 "real payment-provider integration" — customer starts
   * checkout on an accepted invoice; gets back Paystack's hosted-checkout
   * URL (or a dry-run placeholder without PAYSTACK_SECRET_KEY). */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.CUSTOMER)
  @Post('invoices/:invoiceId/pay')
  initiatePayment(@CurrentUser() user: AuthenticatedUser, @Param('invoiceId') invoiceId: string) {
    return this.commerceService.initiatePayment(user, invoiceId);
  }

  /** P0 Technical Build Spec Section 20/21 "Payment Architecture" —
   * Finance/Admin-only full or partial refund. `amount` in the body is
   * optional (omit for a full refund of whatever's left); `reason` is
   * always required. */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...FINANCE_ROLES)
  @HttpCode(HttpStatus.OK)
  @Post('admin/payments/:paymentId/refund')
  refundPayment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('paymentId') paymentId: string,
    @Body() dto: RefundPaymentDto,
  ) {
    return this.commerceService.refundPayment(user, paymentId, dto);
  }

  /** P0 Security, Privacy & Trust Architecture v1.0 §8 "Privileged Action
   * Matrix" — "Refund | Finance permission + threshold approval where
   * configured." Finance's queue of pending (and, via ?status=, decided)
   * refund requests created when refundPayment's amount exceeds
   * REFUND_APPROVAL_THRESHOLD_NGN. */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...FINANCE_ROLES)
  @Get('admin/refund-requests')
  listRefundRequests(@Query('status') status?: RefundRequestStatus) {
    return this.commerceService.listRefundRequests(status);
  }

  /** Maker-checker: the requester (refundPayment's actor) cannot approve
   * their own request — enforced in the service, not just the UI. */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...FINANCE_ROLES)
  @HttpCode(HttpStatus.OK)
  @Post('admin/refund-requests/:id/approve')
  approveRefundRequest(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: DecideRefundRequestDto,
  ) {
    return this.commerceService.approveRefundRequest(user, id, dto.note);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...FINANCE_ROLES)
  @HttpCode(HttpStatus.OK)
  @Post('admin/refund-requests/:id/reject')
  rejectRefundRequest(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: DecideRefundRequestDto,
  ) {
    return this.commerceService.rejectRefundRequest(user, id, dto.note);
  }

  /** Database Schema & ERD Design v1.0 Section 17 "Finance Schema" —
   * `reconciliations`. Finance-only. Resolves a payment stuck on
   * RECONCILIATION_REQUIRED (a webhook amount mismatch) as either MATCHED
   * (accept the amount received, move to PAID) or REJECTED (move to
   * FAILED, freeing the case up for a fresh payment attempt). `notes` is
   * always required. */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...FINANCE_ROLES)
  @HttpCode(HttpStatus.OK)
  @Post('admin/payments/:paymentId/reconcile')
  resolveReconciliation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('paymentId') paymentId: string,
    @Body() dto: ResolveReconciliationDto,
  ) {
    return this.commerceService.resolveReconciliation(user, paymentId, dto);
  }

  /** Same on-demand-sweep pattern as
   * ConciergeController.runBillingSweep — lets ops/testing trigger the
   * hourly PaymentExpirySchedulerService cron without waiting on the
   * clock. */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  @Post('admin/payments/run-expiry-sweep')
  runPaymentExpirySweep() {
    return this.commerceService.runPaymentExpirySweep();
  }

  /** Same on-demand-sweep pattern, for QuoteExpirySchedulerService. */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  @Post('admin/quotes/run-expiry-sweep')
  runQuoteExpirySweep() {
    return this.commerceService.runQuoteExpirySweep();
  }

  /**
   * Single Paystack webhook endpoint for the whole app — real signature
   * verification (PaystackWebhookGuard), not a shared-secret stand-in
   * (Non-Negotiable #4). Routes by reference prefix to whichever service
   * actually owns that kind of payment; case payments and subscription
   * billing intentionally share one endpoint, exactly as Paystack expects
   * one webhook URL per account.
   */
  @UseGuards(PaystackWebhookGuard)
  @Post('payments/webhook/paystack')
  async handlePaystackWebhook(@Req() req: Request) {
    const event = req.body as PaystackChargeEvent;

    // Every other Paystack event type (transfer.*, subscription.*, etc.)
    // genuinely has nothing for this app to do with it yet — acknowledging
    // without acting is correct there. `charge.success`/`charge.failed`
    // are the two that must never be silently dropped: a declined card
    // used to vanish into an "ignored" response with the customer never
    // told why their payment didn't go through.
    if (event.event !== 'charge.success' && event.event !== 'charge.failed') {
      return { received: true, ignored: event.event };
    }

    const { reference, amount, gateway_response: gatewayResponse } = event.data;
    const isCaseInvoice = reference.startsWith(CASE_INVOICE_REFERENCE_PREFIX);
    const isSubscriptionInvoice = reference.startsWith(SUBSCRIPTION_INVOICE_REFERENCE_PREFIX);
    if (!isCaseInvoice && !isSubscriptionInvoice) {
      throw new BadRequestException(`Unrecognised payment reference: ${reference}`);
    }

    if (event.event === 'charge.failed') {
      return isCaseInvoice
        ? this.commerceService.handleFailedCasePayment(reference, gatewayResponse)
        : this.subscriptionBilling.handleFailedSubscriptionPayment(reference, gatewayResponse);
    }

    return isCaseInvoice
      ? this.commerceService.handleVerifiedCasePayment(reference, amount)
      : this.subscriptionBilling.handleVerifiedSubscriptionPayment(reference, amount);
  }
}

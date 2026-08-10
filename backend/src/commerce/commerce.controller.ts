import { BadRequestException, Body, Controller, HttpCode, HttpStatus, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
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

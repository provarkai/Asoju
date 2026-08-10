import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { CaseStatus, CaseTier, PaymentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CasesService } from '../cases/cases.service';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { PaystackService } from '../payments/paystack.service';
import { MembershipService } from '../concierge/membership.service';
import { CreateQuoteDto } from './dto/create-quote.dto';

/** Prefix distinguishing case-invoice Paystack references from subscription
 * ones so a single webhook endpoint can route both (see PaystackService). */
export const CASE_INVOICE_REFERENCE_PREFIX = 'caseinv_';

@Injectable()
export class CommerceService {
  private readonly logger = new Logger(CommerceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly casesService: CasesService,
    private readonly paystack: PaystackService,
    private readonly membership: MembershipService,
  ) {}

  /**
   * Vertical slice 2, step 1: Case -> Quote. Requires the case to already
   * be under review; creating the quote is what moves it to QUOTED
   * (Section 5.2).
   */
  async createQuote(actor: AuthenticatedUser, caseId: string, dto: CreateQuoteDto) {
    const serviceCase = await this.prisma.serviceCase.findUnique({
      where: { id: caseId },
      include: { customer: true },
    });
    if (!serviceCase) throw new NotFoundException('Case not found');
    if (serviceCase.status !== CaseStatus.UNDER_REVIEW) {
      throw new BadRequestException(`Cannot quote a case in status ${serviceCase.status}`);
    }

    // P0 Technical Build Spec Section 17 — "Membership discounts are
    // calculated server-side," never entered by staff. This is a
    // read-only projection (no SC ledger write yet — see acceptQuote);
    // dto.amount is always the ASOJU fee staff actually intends, whether
    // or not a benefit ends up applying.
    const benefit =
      serviceCase.tier === CaseTier.CONCIERGE
        ? await this.membership.previewBenefit(serviceCase.customerId, serviceCase.tier, dto.amount)
        : null;

    const quote = await this.prisma.quote.create({
      data: {
        caseId,
        amount: benefit ? benefit.finalAmount : dto.amount,
        currency: dto.currency ?? 'NGN',
        breakdown: dto.breakdown as any,
        subscriptionId: benefit?.subscriptionId,
        baseAmount: benefit ? dto.amount : undefined,
        discountPercent: benefit?.discountPercent,
        discountAmount: benefit?.discountAmount,
        scAppliedNgn: benefit?.scAppliedNgn,
      },
    });

    await this.casesService.transitionCase(actor, caseId, CaseStatus.QUOTED, 'Quote issued');
    await this.audit.record({
      caseId,
      actorId: actor.id,
      actorType: 'user',
      action: 'quote.created',
      metadata: { quoteId: quote.id, amount: quote.amount, currency: quote.currency, membershipApplied: Boolean(benefit) },
    });
    const benefitNote = benefit
      ? ` (includes your membership discount and SC — ${quote.currency} ${dto.amount.toLocaleString()} before benefits)`
      : '';
    await this.notifications.notify(
      serviceCase.customer.userId,
      'Your quote is ready',
      `We've put together a quote of ${quote.currency} ${Number(quote.amount).toLocaleString()} for ${serviceCase.caseNumber}${benefitNote}. Review and accept it to get scheduled.`,
    );

    return quote;
  }

  /**
   * Vertical slice 2, step 2: Quote -> Payment. Customer acceptance
   * creates the Invoice and moves the case to AWAITING_PAYMENT — payment
   * status itself still only ever changes via the provider webhook
   * (Non-Negotiable #4).
   */
  async acceptQuote(actor: AuthenticatedUser, quoteId: string) {
    const quote = await this.prisma.quote.findUnique({
      where: { id: quoteId },
      include: { case: { include: { customer: true } } },
    });
    if (!quote) throw new NotFoundException('Quote not found');
    if (quote.case.customer.userId !== actor.id) {
      throw new BadRequestException('Not authorised for this quote');
    }
    if (quote.acceptedAt) {
      throw new BadRequestException('Quote already accepted');
    }

    // The point of real commitment — re-validates SC availability against
    // *now*, not the stale preview from createQuote, and only here does an
    // actual DEBIT ledger entry get written (MembershipService.commitBenefit).
    const { finalAmount, adjusted } = await this.membership.commitBenefit(quote);

    const [, invoice] = await this.prisma.$transaction([
      this.prisma.quote.update({
        where: { id: quoteId },
        data: { acceptedAt: new Date(), ...(adjusted ? { amount: finalAmount } : {}) },
      }),
      this.prisma.invoice.create({
        data: { caseId: quote.caseId, quoteId: quote.id, amount: finalAmount, currency: quote.currency },
      }),
    ]);

    await this.casesService.transitionCase(actor, quote.caseId, CaseStatus.AWAITING_PAYMENT, 'Quote accepted');
    await this.audit.record({
      caseId: quote.caseId,
      actorId: actor.id,
      actorType: 'user',
      action: 'quote.accepted',
      metadata: { quoteId, invoiceId: invoice.id, finalAmount, adjusted },
    });
    if (adjusted) {
      // The displayed quote amount and what's actually payable diverged
      // between createQuote and now (e.g. SC got spent on another case in
      // the meantime) — surfaced, not silently charged.
      await this.notifications.notify(
        quote.case.customer.userId,
        'Your invoice amount was adjusted',
        `Your membership benefit changed since this quote was issued, so the payable amount is now ${quote.currency} ${finalAmount.toLocaleString()} instead of the originally shown amount.`,
      );
    }

    return invoice;
  }

  /**
   * Vertical slice 2, step 3a: customer starts payment on an accepted
   * invoice. Creates the Payment row PENDING and hands back Paystack's
   * hosted-checkout URL — real if PAYSTACK_SECRET_KEY is set, a dry-run
   * placeholder otherwise (see PaystackService). Nothing here can mark a
   * payment PAID; only the verified webhook below can (Non-Negotiable #4).
   */
  async initiatePayment(actor: AuthenticatedUser, invoiceId: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { case: { include: { customer: { include: { user: true } } } }, payments: true },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.case.customer.userId !== actor.id) {
      throw new ForbiddenException('Not authorised for this invoice');
    }

    const alreadyPaid = invoice.payments.some((p) => p.status === PaymentStatus.PAID);
    if (alreadyPaid) throw new BadRequestException('Invoice already paid');

    const reference = `${CASE_INVOICE_REFERENCE_PREFIX}${invoice.id}_${randomBytes(4).toString('hex')}`;
    const amountKobo = Math.round(Number(invoice.amount) * 100);

    const result = await this.paystack.initializeTransaction({
      email: invoice.case.customer.user.email ?? `${invoice.case.customer.user.id}@asoju.invalid`,
      amountKobo,
      reference,
      currency: invoice.currency,
      metadata: { invoiceId: invoice.id, caseId: invoice.caseId },
    });

    await this.prisma.payment.create({
      data: {
        invoiceId: invoice.id,
        amount: invoice.amount,
        currency: invoice.currency,
        provider: 'paystack',
        providerReference: reference,
        status: PaymentStatus.PENDING,
      },
    });

    await this.audit.record({
      caseId: invoice.caseId,
      actorId: actor.id,
      actorType: 'user',
      action: 'payment.initiated',
      metadata: { invoiceId: invoice.id, reference, dryRun: result.dryRun },
    });

    return { authorizationUrl: result.authorizationUrl, reference: result.reference, dryRun: result.dryRun };
  }

  /**
   * Vertical slice 2, step 3b: Payment -> Scheduled. The ONLY method in the
   * codebase permitted to set a Payment's verified-webhook timestamp
   * (Non-Negotiable #4). Called only from the PaystackWebhookGuard-protected
   * route, after signature verification, for a `caseinv_` reference.
   */
  async handleVerifiedCasePayment(reference: string, amountKobo: number) {
    const payment = await this.prisma.payment.findUnique({
      where: { providerReference: reference },
      include: { invoice: { include: { case: { include: { customer: true } } } } },
    });
    if (!payment) throw new NotFoundException(`No payment pending for reference ${reference}`);

    const expectedKobo = Math.round(Number(payment.amount) * 100);
    if (expectedKobo !== amountKobo) {
      // Signature is valid (Paystack really sent this), but the amount
      // doesn't match what we initialized — surface loudly rather than
      // silently trusting a mismatched figure.
      this.logger.error(`Paystack amount mismatch for ${reference}: expected ${expectedKobo}kobo, got ${amountKobo}kobo`);
      throw new BadRequestException('Payment amount does not match invoice');
    }

    if (payment.status === PaymentStatus.PAID) {
      return payment; // already processed — webhooks can be delivered more than once
    }

    const updated = await this.prisma.payment.update({
      where: { id: payment.id },
      data: { status: PaymentStatus.PAID, providerWebhookVerifiedAt: new Date() },
    });

    const invoice = payment.invoice;
    const serviceCase = await this.prisma.serviceCase.update({
      where: { id: invoice.caseId },
      data: { paymentStatus: PaymentStatus.PAID },
    });

    await this.audit.record({
      caseId: invoice.caseId,
      actorType: 'system',
      action: 'payment.webhook_verified',
      metadata: { paymentId: updated.id, provider: 'paystack', providerReference: reference },
    });
    await this.notifications.notify(
      invoice.case.customer.userId,
      'Payment received',
      `We've confirmed your payment for ${invoice.case.caseNumber} — we'll be in touch to schedule the visit.`,
    );

    if (serviceCase.status === CaseStatus.AWAITING_PAYMENT) {
      await this.casesService.systemTransitionCase(
        invoice.caseId,
        CaseStatus.SCHEDULED,
        'Payment verified by Paystack webhook',
      );
    }

    return updated;
  }

  /**
   * Section "Payments" hardening — a `charge.failed` webhook used to be
   * silently ignored (only `charge.success` was handled), which meant a
   * declined card left the customer staring at "Awaiting payment" with no
   * idea why. This records the failure and tells them, without changing
   * case status — the customer stays on AWAITING_PAYMENT and can retry
   * with POST /invoices/:id/pay.
   */
  async handleFailedCasePayment(reference: string, gatewayResponse?: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { providerReference: reference },
      include: { invoice: { include: { case: { include: { customer: true } } } } },
    });
    if (!payment) throw new NotFoundException(`No payment pending for reference ${reference}`);

    if (payment.status === PaymentStatus.PAID) {
      // A late/out-of-order failure webhook for a reference we already
      // confirmed paid via another event — never downgrade a paid record.
      return payment;
    }
    if (payment.status === PaymentStatus.FAILED) {
      return payment; // already recorded — webhooks can be delivered more than once
    }

    const updated = await this.prisma.payment.update({
      where: { id: payment.id },
      data: { status: PaymentStatus.FAILED },
    });

    await this.audit.record({
      caseId: payment.invoice.caseId,
      actorType: 'system',
      action: 'payment.webhook_failed',
      metadata: { paymentId: updated.id, provider: 'paystack', providerReference: reference, gatewayResponse },
    });
    await this.notifications.notify(
      payment.invoice.case.customer.userId,
      'Payment did not go through',
      `Your payment for ${payment.invoice.case.caseNumber} wasn't successful${gatewayResponse ? ` (${gatewayResponse})` : ''} — you can try again from your case page.`,
    );

    return updated;
  }
}

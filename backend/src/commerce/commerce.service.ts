import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import {
  CaseStatus,
  CaseTier,
  IdempotencyOperation,
  PaymentStatus,
  Prisma,
  QuoteLineCategory,
  ReconciliationStatus,
  RefundRequestStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CasesService } from '../cases/cases.service';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { PaystackService } from '../payments/paystack.service';
import { MembershipService } from '../concierge/membership.service';
import { ScopeService } from '../scope/scope.service';
import { CreateQuoteDto } from './dto/create-quote.dto';
import { RefundPaymentDto } from './dto/refund-payment.dto';
import { ResolveReconciliationDto } from './dto/resolve-reconciliation.dto';
import { RecordDirectCostDto } from './dto/record-direct-cost.dto';
import { suggestRegionalServiceFee } from './regional-pricing';
import { usdToNgnRate } from '../concierge/membership-plans';
import { IdempotencyService } from '../common/idempotency/idempotency.service';

/** Prefix distinguishing case-invoice Paystack references from subscription
 * ones so a single webhook endpoint can route both (see PaystackService). */
export const CASE_INVOICE_REFERENCE_PREFIX = 'caseinv_';

const DEFAULT_PAYMENT_EXPIRY_HOURS = 24;

/** P0 Technical Build Spec Section 21 "Payment States" — EXPIRED: "Payment
 * window expired." How long a checkout stays open before the sweep below
 * expires it — configurable per environment, same pattern as
 * USD_TO_NGN_RATE (an operator-set number, not a value baked into code). */
function paymentExpiryHours(): number {
  const configured = process.env.PAYMENT_EXPIRY_HOURS;
  const parsed = configured ? Number(configured) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_PAYMENT_EXPIRY_HOURS;
}

const DEFAULT_QUOTE_VALIDITY_HOURS = 24 * 7; // 7 days

/** ASOJU Platform Database Schema & ERD Design v1.0 Section 10 — "Quote
 * versioning is mandatory... A quote must preserve the exact FX rate
 * used" — and the API spec's "Expired quotes cannot release execution."
 * How long a quote stays acceptable before the sweep below reopens the
 * case for re-quoting — configurable per environment, same pattern as
 * PAYMENT_EXPIRY_HOURS/USD_TO_NGN_RATE. */
function quoteValidityHours(): number {
  const configured = process.env.QUOTE_VALIDITY_HOURS;
  const parsed = configured ? Number(configured) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_QUOTE_VALIDITY_HOURS;
}

const DEFAULT_FX_LOCK_HOURS = 48;

/** Platform Expansion PRD §4.3 — "This rate is locked for 48 hours."
 * Configurable per environment, same pattern as QUOTE_VALIDITY_HOURS/
 * PAYMENT_EXPIRY_HOURS. Purely informational (see Quote.fxLockExpiry's
 * schema comment) — does not gate acceptance; the quote's own expiresAt
 * is the real deadline. */
function fxLockHours(): number {
  const configured = process.env.FX_LOCK_HOURS;
  const parsed = configured ? Number(configured) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_FX_LOCK_HOURS;
}

const DEFAULT_REFUND_APPROVAL_THRESHOLD_NGN = 200_000;

/** P0 Security, Privacy & Trust Architecture v1.0 §8 "Privileged Action
 * Matrix" — "Refund | Finance permission + threshold approval where
 * configured." Configurable per environment, same pattern as
 * QUOTE_VALIDITY_HOURS/PAYMENT_EXPIRY_HOURS. A refund at or below this
 * amount executes immediately as before; above it requires a second,
 * different Finance/Admin/SuperAdmin actor's approval. */
function refundApprovalThresholdNgn(): number {
  const configured = process.env.REFUND_APPROVAL_THRESHOLD_NGN;
  const parsed = configured ? Number(configured) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_REFUND_APPROVAL_THRESHOLD_NGN;
}

const DEFAULT_PAYMENT_VERIFICATION_MIN_AGE_MINUTES = 5;

/** How long a PENDING payment must sit before the verification sweep below
 * asks Paystack about it directly — gives the webhook (the primary, faster
 * path) a real chance to land first, so this never races it. Configurable
 * per environment, same pattern as PAYMENT_EXPIRY_HOURS. */
function paymentVerificationMinAgeMinutes(): number {
  const configured = process.env.PAYMENT_VERIFICATION_MIN_AGE_MINUTES;
  const parsed = configured ? Number(configured) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_PAYMENT_VERIFICATION_MIN_AGE_MINUTES;
}

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
    private readonly scope: ScopeService,
    private readonly idempotency: IdempotencyService,
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

    // P0 Technical Build Spec Section 14 / EPIC F — "cannot silently
    // expand execution": a quote can only ever be issued against a scope
    // the customer has actually confirmed, never a bare description.
    // Revising the scope after this starts a new, unconfirmed version
    // (ScopeService.createOrRevise) — it does not retroactively invalidate
    // an already-issued quote, but staff can't issue a *new* one until the
    // customer re-confirms.
    const latestScope = await this.scope.getLatest(caseId);
    if (!latestScope) {
      throw new BadRequestException('This case has no scope yet — create one and have the customer confirm it before quoting');
    }
    if (!latestScope.confirmedAt) {
      throw new BadRequestException('The customer has not confirmed the current scope yet — cannot quote until they do');
    }

    // P0 Technical Build Spec Section 16 "Quote Line Categories" —
    // discount/SC eligibility is explicit per line: only ASOJU_SERVICE_FEE
    // lines feed the discountable base; EXTERNAL_COST/THIRD_PARTY_
    // PROFESSIONAL/TAX_STATUTORY pass through untouched, added back on top
    // afterwards (Section 4's "Do not hide external costs inside ASOJU
    // fees").
    const serviceFeeTotal = dto.lines
      .filter((l) => l.category === QuoteLineCategory.ASOJU_SERVICE_FEE)
      .reduce((sum, l) => sum + l.amount, 0);
    const nonServiceFeeTotal = dto.lines
      .filter((l) => l.category !== QuoteLineCategory.ASOJU_SERVICE_FEE)
      .reduce((sum, l) => sum + l.amount, 0);

    // P0 Technical Build Spec Section 17 — "Membership discounts are
    // calculated server-side," never entered by staff. Read-only
    // projection (no SC ledger write yet — see acceptQuote), against the
    // service-fee lines only — a quote made up entirely of external/
    // third-party costs (serviceFeeTotal === 0) is never eligible, and
    // never counts against the monthly allowance either.
    const benefit =
      serviceCase.tier === CaseTier.CONCIERGE && serviceFeeTotal > 0
        ? await this.membership.previewBenefit(serviceCase.customerId, serviceCase.tier, serviceFeeTotal, latestScope.zone)
        : null;

    const finalServiceFee = benefit ? benefit.finalAmount : serviceFeeTotal;
    const amount = finalServiceFee + nonServiceFeeTotal;

    // Platform Expansion PRD §4.3 — pinned once, at the moment the
    // customer first sees a price, from the same rate Subscription
    // pricing already locks. Only meaningful when there's an actual
    // ASOJU_SERVICE_FEE portion to express in USD.
    const fxRate = serviceFeeTotal > 0 ? usdToNgnRate() : null;

    const quote = await this.prisma.quote.create({
      data: {
        caseId,
        amount,
        currency: dto.currency ?? 'NGN',
        // ASOJU Platform Database Schema & ERD Design v1.0 Section 10 —
        // "Quote has validity." Enforced in acceptQuote() below and swept
        // by runQuoteExpirySweep() — never just decorative.
        expiresAt: new Date(Date.now() + quoteValidityHours() * 60 * 60 * 1000),
        scopeId: latestScope.id,
        subscriptionId: benefit?.subscriptionId,
        baseAmount: serviceFeeTotal,
        nonServiceFeeAmount: nonServiceFeeTotal,
        discountPercent: benefit?.discountPercent,
        discountAmount: benefit?.discountAmount,
        scAppliedNgn: benefit?.scAppliedNgn,
        lockedFxRate: fxRate,
        sourceCurrency: fxRate ? 'USD' : null,
        fxLockExpiry: fxRate ? new Date(Date.now() + fxLockHours() * 60 * 60 * 1000) : null,
        // docs/AUTOMATION_PRICING_ENGINE_SCOPE.md Phase 1 traceability —
        // undefined (not persisted) for the common case of a fully
        // staff-typed quote; only set when dto.priceBookId was passed
        // through from the pricing-preview calculator.
        priceBookId: dto.priceBookId,
        lines: { create: dto.lines.map((l) => ({ category: l.category, label: l.label, amount: l.amount })) },
      },
      include: { lines: true },
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
      ? ` (includes your membership discount and SC on the service fee — ${quote.currency} ${serviceFeeTotal.toLocaleString()} before benefits)`
      : '';
    const externalNote = nonServiceFeeTotal > 0 ? ` This includes ${quote.currency} ${nonServiceFeeTotal.toLocaleString()} in external/third-party costs, separate from our fee.` : '';
    await this.notifications.notify(
      serviceCase.customer.userId,
      'Your quote is ready',
      `We've put together a quote of ${quote.currency} ${Number(quote.amount).toLocaleString()} for ${serviceCase.caseNumber}${benefitNote}.${externalNote} Review and accept it to get scheduled.`,
    );

    return quote;
  }

  /**
   * Platform Expansion PRD §2.2/§2.3 — staff-facing preview of what the
   * regional matrix says this case's ASOJU_SERVICE_FEE line(s) should be,
   * and whether SC will even be offered, *before* they build the actual
   * quote lines by hand (createQuote's dto.lines stays authoritative —
   * this is guidance, not an auto-applied price). Requires a confirmed
   * scope, same precondition as createQuote itself, since the zone lives
   * on CaseScope.
   */
  async getRegionalPricingHint(caseId: string) {
    const serviceCase = await this.prisma.serviceCase.findUnique({ where: { id: caseId } });
    if (!serviceCase) throw new NotFoundException('Case not found');

    const latestScope = await this.scope.getLatest(caseId);
    if (!latestScope) {
      throw new BadRequestException('This case has no scope yet — create one before requesting a pricing hint');
    }

    const suggestion = suggestRegionalServiceFee(latestScope.zone, serviceCase.priority);
    const fxRate = usdToNgnRate();

    return {
      ...suggestion,
      fxRate,
      suggestedServiceFeeNgn:
        suggestion.suggestedServiceFeeUsd === null ? null : Math.round(suggestion.suggestedServiceFeeUsd * fxRate),
    };
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
    // API Specification v1.0 Section 40 "Critical Business Rules" —
    // "Expired quotes cannot release execution." Never the customer's
    // browser clock deciding this — always the server's now().
    if (quote.expiresAt && quote.expiresAt < new Date()) {
      throw new BadRequestException('This quote has expired — request a new quote for the current terms');
    }

    // Atomically claim the accept before doing anything with a side effect
    // (the SC debit below). The check above is just a fast, friendly error
    // for the common case — this updateMany is what actually prevents it:
    // its WHERE re-checks acceptedAt IS NULL at the database level, so of
    // two concurrent accepts (double-click, client retry) only one can
    // ever match and update the row. Without this, both requests could
    // pass the check above, both debit SC, and both create an Invoice.
    const claim = await this.prisma.quote.updateMany({
      where: { id: quoteId, acceptedAt: null },
      data: { acceptedAt: new Date() },
    });
    if (claim.count === 0) {
      throw new BadRequestException('Quote already accepted');
    }

    // The point of real commitment — re-validates SC availability against
    // *now*, not the stale preview from createQuote, and only here does an
    // actual DEBIT ledger entry get written (MembershipService.commitBenefit).
    const { finalAmount, adjusted } = await this.membership.commitBenefit(quote);

    const [, invoice] = await this.prisma.$transaction([
      this.prisma.quote.update({
        where: { id: quoteId },
        data: adjusted ? { amount: finalAmount } : {},
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
   *
   * docs/AUTOMATION_PRICING_ENGINE_SCOPE.md Phase 2 — idempotencyKey is
   * optional, same contract as createServiceRequest. A retry after the
   * original already succeeded does NOT re-initiate a second Paystack
   * transaction (which would double the customer-visible checkout
   * attempts against the same invoice) — it returns the already-created
   * Payment's reference instead. There's no authorizationUrl to hand back
   * on replay (Paystack's hosted-checkout URL isn't persisted — it's only
   * ever returned once, from the original call); a client retrying after
   * a timeout should poll payment status by the returned reference rather
   * than expect a fresh checkout link.
   */
  async initiatePayment(actor: AuthenticatedUser, invoiceId: string, idempotencyKey?: string) {
    if (idempotencyKey) {
      const check = await this.idempotency.begin(IdempotencyOperation.PAYMENT_INITIATE, idempotencyKey, actor.id);
      if (!check.shouldProceed) {
        const payment = await this.prisma.payment.findUniqueOrThrow({ where: { id: check.resultReference! } });
        return { reference: payment.providerReference, dryRun: false, replay: true };
      }
    }

    try {
      const result = await this.doInitiatePayment(actor, invoiceId);
      if (idempotencyKey) {
        await this.idempotency.complete(IdempotencyOperation.PAYMENT_INITIATE, idempotencyKey, actor.id, result.paymentId);
      }
      return { authorizationUrl: result.authorizationUrl, reference: result.reference, dryRun: result.dryRun };
    } catch (err) {
      if (idempotencyKey) {
        await this.idempotency.fail(IdempotencyOperation.PAYMENT_INITIATE, idempotencyKey, actor.id);
      }
      throw err;
    }
  }

  private async doInitiatePayment(actor: AuthenticatedUser, invoiceId: string) {
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

    const payment = await this.prisma.payment.create({
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

    return { authorizationUrl: result.authorizationUrl, reference: result.reference, dryRun: result.dryRun, paymentId: payment.id };
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
      // doesn't match what we initialized. P0 Technical Build Spec Section
      // 21 — "RECONCILIATION_REQUIRED: Mismatch requiring Finance review."
      // Persisted (not just logged, and not silently trusted either) so
      // Finance actually sees it rather than the payment sitting PENDING
      // forever with no distinguishing flag that anything went wrong.
      this.logger.error(`Paystack amount mismatch for ${reference}: expected ${expectedKobo}kobo, got ${amountKobo}kobo`);
      if (payment.status !== PaymentStatus.PAID) {
        await this.prisma.payment.update({ where: { id: payment.id }, data: { status: PaymentStatus.RECONCILIATION_REQUIRED } });
        await this.prisma.serviceCase.update({
          where: { id: payment.invoice.caseId },
          data: { paymentStatus: PaymentStatus.RECONCILIATION_REQUIRED },
        });
        await this.audit.record({
          caseId: payment.invoice.caseId,
          actorType: 'system',
          action: 'payment.reconciliation_required',
          metadata: { paymentId: payment.id, providerReference: reference, expectedKobo, receivedKobo: amountKobo },
        });
      }
      throw new BadRequestException('Payment amount does not match invoice — flagged for Finance review');
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

  /**
   * P0 Technical Build Spec Section 20/21 "Payment Architecture / Payment
   * States" — "Support failed, pending, reversed and refunded states."
   * Finance/Admin only (enforced by the controller's @Roles). Always
   * requires a reason (RefundPaymentDto), same discipline as
   * ScLedgerService.adjust — an authorized human action with a recorded
   * reason is the source of truth here, not a webhook (unlike marking a
   * payment PAID, this is money leaving on ASOJU's own initiative, not a
   * customer's claim — Non-Negotiable #4 doesn't apply the same way).
   * Full or partial: omitting `amount` refunds whatever's left; providing
   * one partially refunds it, and the Payment moves to PARTIALLY_REFUNDED
   * rather than REFUNDED until the full amount has been returned.
   */
  private async remainingRefundable(
    db: PrismaService | Prisma.TransactionClient,
    paymentId: string,
    paymentAmount: Prisma.Decimal | number,
  ): Promise<number> {
    const alreadyRefunded = await db.refund.aggregate({ where: { paymentId }, _sum: { amount: true } });
    const refundedSoFar = Number(alreadyRefunded._sum.amount ?? 0);
    return Number(paymentAmount) - refundedSoFar;
  }

  /** Serializes concurrent refunds against the same payment. `SELECT ...
   * FOR UPDATE` locks the Payment row for the transaction's lifetime, so a
   * second concurrent refund attempt on the same payment blocks until the
   * first commits — then it re-reads remainingRefundable and sees the
   * first refund's now-committed Refund row. Without this, two concurrent
   * refund requests (two Finance actors, or one retried request) can both
   * read the same "remaining" value via remainingRefundable's aggregate
   * and together refund more than the payment ever had. */
  private async withPaymentLock<T>(paymentId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Payment" WHERE id = ${paymentId} FOR UPDATE`;
      return fn(tx);
    });
  }

  /** The actual refund: Paystack call, Refund row, Payment/case status
   * update, audit, customer notification. Shared by the immediate
   * (below-threshold) path and approveRefundRequest (above-threshold,
   * post-approval) — the two differ only in *when* this runs and who
   * authorized it, never in what it does. Callers are expected to have
   * already validated `requested` against a lock-held remainingRefundable
   * (withPaymentLock) and to pass that same `db` handle through here, so
   * the Refund row this writes lands inside the same locked transaction
   * as the validation that authorized it. */
  private async executeRefund(
    db: PrismaService | Prisma.TransactionClient,
    actor: AuthenticatedUser,
    payment: Prisma.PaymentGetPayload<{ include: { invoice: { include: { case: { include: { customer: true } } } } } }>,
    requested: number,
    reason: string | null,
  ) {
    const refundedSoFar = Number(payment.amount) - (await this.remainingRefundable(db, payment.id, payment.amount));
    const result = await this.paystack.refundTransaction(payment.providerReference, Math.round(requested * 100));

    const refund = await db.refund.create({
      data: { paymentId: payment.id, amount: requested, reason: reason ?? undefined, actorId: actor.id },
    });

    const newStatus = requested + refundedSoFar >= Number(payment.amount) ? PaymentStatus.REFUNDED : PaymentStatus.PARTIALLY_REFUNDED;
    const updatedPayment = await db.payment.update({ where: { id: payment.id }, data: { status: newStatus } });
    await db.serviceCase.update({ where: { id: payment.invoice.caseId }, data: { paymentStatus: newStatus } });

    await this.audit.record({
      caseId: payment.invoice.caseId,
      actorId: actor.id,
      actorType: 'user',
      action: 'payment.refunded',
      metadata: { paymentId: payment.id, refundId: refund.id, amount: requested, reason, newStatus, dryRun: result.dryRun },
    });
    await this.notifications.notify(
      payment.invoice.case.customer.userId,
      'A refund has been issued',
      `A refund of ${payment.currency} ${requested.toLocaleString()} has been issued for ${payment.invoice.case.caseNumber}.`,
    );

    return { refund, payment: updatedPayment };
  }

  /**
   * P0 Security, Privacy & Trust Architecture v1.0 §8 "Privileged Action
   * Matrix" — "Refund | Finance permission + threshold approval where
   * configured." A refund at or below REFUND_APPROVAL_THRESHOLD_NGN
   * executes immediately, exactly as before; above it, this creates a
   * pending RefundRequest instead of touching Paystack or the ledger at
   * all — approveRefundRequest is the only path that actually moves
   * money once a request exists.
   */
  async refundPayment(actor: AuthenticatedUser, paymentId: string, dto: RefundPaymentDto) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: { invoice: { include: { case: { include: { customer: true } } } } },
    });
    if (!payment) throw new NotFoundException('Payment not found');
    if (payment.status !== PaymentStatus.PAID && payment.status !== PaymentStatus.PARTIALLY_REFUNDED) {
      throw new BadRequestException(`Cannot refund a payment in status ${payment.status}`);
    }

    const remaining = await this.remainingRefundable(this.prisma, paymentId, payment.amount);
    const requested = dto.amount ?? remaining;
    if (requested <= 0 || requested > remaining) {
      throw new BadRequestException(`Refund amount must be between 0 and the remaining refundable amount (${remaining})`);
    }

    const threshold = refundApprovalThresholdNgn();
    if (requested > threshold) {
      const refundRequest = await this.prisma.refundRequest.create({
        data: { paymentId, amount: requested, reason: dto.reason, requestedById: actor.id },
      });
      await this.audit.record({
        caseId: payment.invoice.caseId,
        actorId: actor.id,
        actorType: 'user',
        action: 'payment.refund_requested',
        metadata: { paymentId, refundRequestId: refundRequest.id, amount: requested, reason: dto.reason, thresholdNgn: threshold },
      });
      return { refundRequest };
    }

    // Re-validated under a row lock immediately before executing — the
    // check above is a fast, friendly error for the common case; this is
    // what actually prevents two concurrent refunds on the same payment
    // from together exceeding its total amount (see withPaymentLock).
    return this.withPaymentLock(paymentId, async (tx) => {
      const lockedRemaining = await this.remainingRefundable(tx, paymentId, payment.amount);
      if (requested <= 0 || requested > lockedRemaining) {
        throw new BadRequestException(`Refund amount must be between 0 and the remaining refundable amount (${lockedRemaining})`);
      }
      return this.executeRefund(tx, actor, payment, requested, dto.reason);
    });
  }

  /** Approves a pending RefundRequest and executes the refund. Deliberately
   * blocks the requester from approving their own request — a maker-checker
   * control is not a control if the maker can also be the checker. */
  async approveRefundRequest(actor: AuthenticatedUser, refundRequestId: string, note?: string) {
    const refundRequest = await this.prisma.refundRequest.findUnique({
      where: { id: refundRequestId },
      include: { payment: { include: { invoice: { include: { case: { include: { customer: true } } } } } } },
    });
    if (!refundRequest) throw new NotFoundException('Refund request not found');
    if (refundRequest.status !== RefundRequestStatus.PENDING) {
      throw new BadRequestException(`Refund request is already ${refundRequest.status}`);
    }
    if (refundRequest.requestedById === actor.id) {
      throw new ForbiddenException('The refund cannot be approved by the same person who requested it');
    }

    const payment = refundRequest.payment;
    if (payment.status !== PaymentStatus.PAID && payment.status !== PaymentStatus.PARTIALLY_REFUNDED) {
      throw new BadRequestException(`Cannot refund a payment in status ${payment.status}`);
    }
    const requested = Number(refundRequest.amount);

    // Same row-locked re-validation as refundPayment's immediate path (see
    // withPaymentLock) — without it, this request's approval could race
    // another refund on the same payment (a second RefundRequest approval,
    // or a below-threshold immediate refund) and together exceed the
    // payment's total amount.
    const result = await this.withPaymentLock(payment.id, async (tx) => {
      const remaining = await this.remainingRefundable(tx, payment.id, payment.amount);
      if (requested <= 0 || requested > remaining) {
        throw new BadRequestException(
          `Refund amount must be between 0 and the remaining refundable amount (${remaining}) — it may have changed since this request was made`,
        );
      }
      return this.executeRefund(tx, actor, payment, requested, refundRequest.reason);
    });

    await this.prisma.refundRequest.update({
      where: { id: refundRequestId },
      data: { status: RefundRequestStatus.APPROVED, decidedById: actor.id, decidedAt: new Date(), decisionNote: note },
    });
    await this.audit.record({
      caseId: payment.invoice.caseId,
      actorId: actor.id,
      actorType: 'user',
      action: 'payment.refund_request_approved',
      metadata: { refundRequestId, paymentId: payment.id, amount: requested, note },
    });

    return result;
  }

  /** Rejects a pending RefundRequest — no money moves, nothing else about
   * the payment changes. Same maker-checker restriction as approval. */
  async rejectRefundRequest(actor: AuthenticatedUser, refundRequestId: string, note?: string) {
    const refundRequest = await this.prisma.refundRequest.findUnique({
      where: { id: refundRequestId },
      include: { payment: { include: { invoice: true } } },
    });
    if (!refundRequest) throw new NotFoundException('Refund request not found');
    if (refundRequest.status !== RefundRequestStatus.PENDING) {
      throw new BadRequestException(`Refund request is already ${refundRequest.status}`);
    }
    if (refundRequest.requestedById === actor.id) {
      throw new ForbiddenException('The refund cannot be rejected by the same person who requested it');
    }

    const updated = await this.prisma.refundRequest.update({
      where: { id: refundRequestId },
      data: { status: RefundRequestStatus.REJECTED, decidedById: actor.id, decidedAt: new Date(), decisionNote: note },
    });
    await this.audit.record({
      caseId: refundRequest.payment.invoice.caseId,
      actorId: actor.id,
      actorType: 'user',
      action: 'payment.refund_request_rejected',
      metadata: { refundRequestId, paymentId: refundRequest.paymentId, note },
    });

    return updated;
  }

  /** Finance's queue — defaults to the actionable set (PENDING) but can
   * list any status for a full audit view. */
  async listRefundRequests(status?: RefundRequestStatus) {
    return this.prisma.refundRequest.findMany({
      where: status ? { status } : undefined,
      include: {
        payment: { select: { amount: true, currency: true, providerReference: true } },
        requestedBy: { select: { email: true } },
        decidedBy: { select: { email: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Database Schema & ERD Design v1.0 Section 17 "Finance Schema" —
   * `reconciliations`. Closes the loop `handleVerifiedCasePayment` opened:
   * a webhook amount mismatch used to leave the Payment (and case) stuck
   * on RECONCILIATION_REQUIRED forever with no action anyone could take.
   * Finance reviews the mismatch (visible via the audit log's
   * `payment.reconciliation_required` event, which carries the
   * expected/received amounts) and resolves it one of two ways:
   *   - MATCHED: the amount actually received is accepted as correct —
   *     optionally recording the corrected amount — and the payment moves
   *     to PAID, same as a normal verified webhook.
   *   - REJECTED: the mismatch was a genuine failure — the payment moves
   *     to FAILED and the case's payment status is freed up so the
   *     customer can start a fresh payment attempt on the same invoice
   *     (initiatePayment has no restriction against a second attempt).
   * Every resolution is a permanent, append-only Reconciliation row —
   * never a mutation of a prior one, same discipline as Refund.
   */
  async resolveReconciliation(actor: AuthenticatedUser, paymentId: string, dto: ResolveReconciliationDto) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: { invoice: { include: { case: { include: { customer: true } } } } },
    });
    if (!payment) throw new NotFoundException('Payment not found');
    if (payment.status !== PaymentStatus.RECONCILIATION_REQUIRED) {
      throw new BadRequestException(`Payment is in status ${payment.status}, not awaiting reconciliation`);
    }

    const newAmount = dto.status === ReconciliationStatus.MATCHED && dto.resolvedAmount ? dto.resolvedAmount : undefined;
    const newPaymentStatus = dto.status === ReconciliationStatus.MATCHED ? PaymentStatus.PAID : PaymentStatus.FAILED;

    const updatedPayment = await this.prisma.payment.update({
      where: { id: paymentId },
      data: {
        status: newPaymentStatus,
        ...(newAmount !== undefined ? { amount: newAmount } : {}),
        ...(newPaymentStatus === PaymentStatus.PAID ? { providerWebhookVerifiedAt: new Date() } : {}),
      },
    });
    await this.prisma.serviceCase.update({ where: { id: payment.invoice.caseId }, data: { paymentStatus: newPaymentStatus } });

    const reconciliation = await this.prisma.reconciliation.create({
      data: { paymentId, status: dto.status, notes: dto.notes, reconciledBy: actor.id },
    });

    await this.audit.record({
      caseId: payment.invoice.caseId,
      actorId: actor.id,
      actorType: 'user',
      action: 'payment.reconciliation_resolved',
      metadata: { paymentId, reconciliationId: reconciliation.id, status: dto.status, notes: dto.notes, resolvedAmount: newAmount },
    });

    await this.notifications.notify(
      payment.invoice.case.customer.userId,
      dto.status === ReconciliationStatus.MATCHED ? 'Your payment has been confirmed' : 'Your payment could not be confirmed',
      dto.status === ReconciliationStatus.MATCHED
        ? `Your payment for ${payment.invoice.case.caseNumber} has been reviewed and confirmed.`
        : `Your payment for ${payment.invoice.case.caseNumber} could not be confirmed — please try again from your case page.`,
    );

    return { reconciliation, payment: updatedPayment };
  }

  /**
   * P0 Technical Build Spec Section 21 "Payment States" — EXPIRED: "Payment
   * window expired." A checkout started via POST /invoices/:id/pay that
   * never resolves (customer abandons it, no webhook ever arrives) used to
   * stay PENDING forever with no distinguishing signal. Run by
   * PaymentExpirySchedulerService's hourly cron; also admin-triggerable
   * (POST /admin/payments/run-expiry-sweep) same as the billing/recurring
   * sweeps, for ops/testing without waiting on the clock. Deliberately
   * touches only the Payment row, never the case's own paymentStatus — the
   * customer can always start a fresh payment on the same invoice
   * (initiatePayment has no restriction against a second attempt), so one
   * expired attempt is never the case's final word on whether it's paid.
   */
  async runPaymentExpirySweep(): Promise<{ expired: number }> {
    const cutoff = new Date(Date.now() - paymentExpiryHours() * 60 * 60 * 1000);
    const stale = await this.prisma.payment.findMany({
      // PROCESSING included alongside PENDING — runPaymentVerificationSweep
      // can move a payment there when Paystack itself reports it still in
      // flight, but that isn't a promise it will ever resolve; one that's
      // been "processing" past the same window gets the same recovery path
      // as an ordinary abandoned checkout.
      where: { status: { in: [PaymentStatus.PENDING, PaymentStatus.PROCESSING] }, createdAt: { lt: cutoff } },
      include: { invoice: { include: { case: { include: { customer: true } } } } },
    });

    for (const payment of stale) {
      await this.prisma.payment.update({ where: { id: payment.id }, data: { status: PaymentStatus.EXPIRED } });
      await this.audit.record({
        caseId: payment.invoice.caseId,
        actorType: 'system',
        action: 'payment.expired',
        metadata: { paymentId: payment.id, providerReference: payment.providerReference, createdAt: payment.createdAt },
      });
      await this.notifications.notify(
        payment.invoice.case.customer.userId,
        'Your payment window expired',
        `The payment window for ${payment.invoice.case.caseNumber} has expired — you can start a new payment from your case page.`,
      );
    }

    return { expired: stale.length };
  }

  /**
   * P0 Technical Build Spec Section 21 "Payment States" — `PROCESSING`
   * existed in the enum with nothing in the app ever setting it (the
   * webhook was the only thing that ever moved a Payment off PENDING).
   * This polls Paystack's own transaction-verify endpoint directly for
   * anything old enough that the webhook has had a fair chance to land
   * (`paymentVerificationMinAgeMinutes`) but not yet past the expiry
   * window (`runPaymentExpirySweep` owns anything past that) — the
   * recovery path for a late or lost webhook, not a replacement for it.
   * Reuses the exact same PAID/FAILED transitions the webhook itself uses
   * (`handleVerifiedCasePayment`/`handleFailedCasePayment`) so there is
   * exactly one place either transition can actually happen from; this
   * method only ever writes `PROCESSING` directly. Without
   * `PAYSTACK_SECRET_KEY` there's no live provider to ask —
   * `PaystackService.verifyTransaction` dry-runs and this sweep is a
   * no-op, same as every other integration in this repo without
   * credentials configured; `PROCESSING` never appears from thin air.
   */
  async runPaymentVerificationSweep(): Promise<{ checked: number; processing: number; paid: number; failed: number }> {
    const minAgeCutoff = new Date(Date.now() - paymentVerificationMinAgeMinutes() * 60 * 1000);
    const expiryCutoff = new Date(Date.now() - paymentExpiryHours() * 60 * 60 * 1000);

    const candidates = await this.prisma.payment.findMany({
      where: {
        status: { in: [PaymentStatus.PENDING, PaymentStatus.PROCESSING] },
        createdAt: { lt: minAgeCutoff, gte: expiryCutoff },
      },
    });

    let processing = 0;
    let paid = 0;
    let failed = 0;

    for (const payment of candidates) {
      let result;
      try {
        result = await this.paystack.verifyTransaction(payment.providerReference);
      } catch (err) {
        this.logger.warn(`Payment verification poll failed for ${payment.providerReference}: ${(err as Error).message}`);
        continue;
      }
      if (result.dryRun || !result.status) continue; // nothing to report without a real provider

      try {
        if (result.status === 'success') {
          await this.handleVerifiedCasePayment(payment.providerReference, result.amountKobo!);
          paid++;
        } else if (result.status === 'failed' || result.status === 'abandoned' || result.status === 'reversed') {
          await this.handleFailedCasePayment(payment.providerReference, result.gatewayResponse);
          failed++;
        } else if (payment.status !== PaymentStatus.PROCESSING) {
          // pending | ongoing | queued — genuinely still in flight at Paystack.
          await this.prisma.payment.update({ where: { id: payment.id }, data: { status: PaymentStatus.PROCESSING } });
          await this.audit.record({
            actorType: 'system',
            action: 'payment.processing',
            metadata: { paymentId: payment.id, providerReference: payment.providerReference, paystackStatus: result.status },
          });
          processing++;
        }
      } catch (err) {
        this.logger.warn(`Payment verification sweep failed to apply result for ${payment.providerReference}: ${(err as Error).message}`);
      }
    }

    return { checked: candidates.length, processing, paid, failed };
  }

  /**
   * ASOJU Database Schema & ERD Design v1.0 Section 10 / API Specification
   * Section 40 — "Expired quotes cannot release execution." Rather than
   * just leaving an expired quote unacceptable (the accept-time check
   * above), this reopens the case for re-quoting instead of leaving it
   * stuck QUOTED forever with no path forward — staff get a clear signal
   * to re-quote, the customer gets told why. Run by
   * QuoteExpirySchedulerService's hourly cron; also admin-triggerable
   * (POST /admin/quotes/run-expiry-sweep) for ops/testing.
   */
  async runQuoteExpirySweep(): Promise<{ expired: number }> {
    const now = new Date();
    const staleQuotes = await this.prisma.quote.findMany({
      where: {
        acceptedAt: null,
        expiresAt: { lt: now },
        case: { status: CaseStatus.QUOTED },
      },
      include: { case: { include: { customer: true } } },
    });

    for (const quote of staleQuotes) {
      // A quote is only ever created while the case is UNDER_REVIEW (see
      // createQuote); re-fetch to guard against two expired quotes on the
      // same case racing this loop (systemTransitionCase would throw on
      // the second, which is correct — nothing to revert twice).
      const current = await this.prisma.serviceCase.findUnique({ where: { id: quote.caseId } });
      if (!current || current.status !== CaseStatus.QUOTED) continue;

      await this.casesService.systemTransitionCase(quote.caseId, CaseStatus.UNDER_REVIEW, 'Quote expired unaccepted');
      await this.audit.record({
        caseId: quote.caseId,
        actorType: 'system',
        action: 'quote.expired',
        metadata: { quoteId: quote.id, expiresAt: quote.expiresAt },
      });
      await this.notifications.notify(
        quote.case.customer.userId,
        'Your quote has expired',
        `The quote for ${quote.case.caseNumber} has expired unaccepted — we'll be in touch with an updated quote, or you can reach out if you're ready to proceed.`,
      );
    }

    return { expired: staleQuotes.length };
  }

  /**
   * P0 Tech Platform §33 "Financial & Analytics Requirements" — "Representative
   * cost. Travel/transport. Third-party costs. Other direct cost." /
   * AnalyticsService.getSummary()'s contribution/contribution-margin
   * calculation reads these back. Finance-only, case-scoped, append-only —
   * same discipline as Refund and Reconciliation: a correction is a new
   * row, never an edit to a prior one.
   */
  async recordDirectCost(actor: AuthenticatedUser, caseId: string, dto: RecordDirectCostDto) {
    const serviceCase = await this.prisma.serviceCase.findUnique({ where: { id: caseId } });
    if (!serviceCase) throw new NotFoundException('Case not found');

    const directCost = await this.prisma.directCost.create({
      data: {
        caseId,
        category: dto.category,
        amount: dto.amount,
        currency: dto.currency ?? 'NGN',
        note: dto.note,
        actorId: actor.id,
      },
    });

    await this.audit.record({
      caseId,
      actorId: actor.id,
      actorType: 'user',
      action: 'case.direct_cost_recorded',
      metadata: { directCostId: directCost.id, category: dto.category, amount: dto.amount, currency: directCost.currency },
    });

    return directCost;
  }

  /** Finance-only, case-scoped — deliberately not part of the general
   * getCaseDetail() response every case-detail viewer (including the
   * customer) hits (API Spec: "Never return internal pricing/margin
   * calculations" to unauthorized clients). */
  async listDirectCosts(caseId: string) {
    const serviceCase = await this.prisma.serviceCase.findUnique({ where: { id: caseId } });
    if (!serviceCase) throw new NotFoundException('Case not found');
    return this.prisma.directCost.findMany({ where: { caseId }, orderBy: { createdAt: 'desc' } });
  }
}

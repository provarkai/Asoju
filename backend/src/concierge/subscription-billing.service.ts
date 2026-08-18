import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { MembershipPlan, PaymentStatus, Prisma, SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PaystackService } from '../payments/paystack.service';
import { ScLedgerService } from './sc-ledger.service';
import { PlanConfigService } from './plan-config.service';
import { BILLING_PERIOD_MS } from './membership-plans';

/** Reference prefix distinguishing subscription-billing Paystack references
 * from case-invoice ones (CASE_INVOICE_REFERENCE_PREFIX in commerce.service)
 * so the one webhook endpoint can route both. */
export const SUBSCRIPTION_INVOICE_REFERENCE_PREFIX = 'subinv_';

interface BillableSubscription {
  id: string;
  amount: Prisma.Decimal;
  currency: string;
  customer: { userId: string; user: { id: string; email: string | null } };
}

/**
 * Section 12 P2 "full subscription engine" — deliberately the bounded,
 * real slice of it. Section 11.2 explicitly rules out a "complex
 * subscription ecosystem": no proration, no plan changes mid-cycle, no
 * multiple tiers — one flat recurring charge per period, billed by the
 * same Paystack integration as case payments, collected the same
 * verified-webhook-only way (Non-Negotiable #4).
 */
@Injectable()
export class SubscriptionBillingService {
  private readonly logger = new Logger(SubscriptionBillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly paystack: PaystackService,
    private readonly scLedger: ScLedgerService,
    private readonly planConfig: PlanConfigService,
  ) {}

  /** Daily sweep (see SubscriptionBillingSchedulerService), also triggerable
   * on demand via POST /admin/subscriptions/run-billing for testing. */
  async runBillingSweep(): Promise<{ billed: number; lapsed: number }> {
    const due = await this.prisma.subscription.findMany({
      where: { status: SubscriptionStatus.ACTIVE, renewsAt: { lte: new Date() } },
      include: {
        customer: { include: { user: true } },
        invoices: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });

    let billed = 0;
    let lapsed = 0;

    for (const subscription of due) {
      const lastInvoice = subscription.invoices[0];
      if (lastInvoice && lastInvoice.status !== PaymentStatus.PAID) {
        // Previous period never got paid — lapse rather than let debt pile up.
        await this.prisma.subscription.update({
          where: { id: subscription.id },
          data: { status: SubscriptionStatus.EXPIRED, cancelledAt: new Date() },
        });
        await this.audit.record({
          actorType: 'system',
          action: 'concierge.subscription_lapsed',
          metadata: { subscriptionId: subscription.id, unpaidInvoiceId: lastInvoice.id },
        });
        await this.notifications.notify(
          subscription.customer.userId,
          'Your Concierge subscription has lapsed',
          "We couldn't confirm payment for your last billing period, so your Concierge subscription has ended. You can resubscribe any time from your profile.",
        );
        lapsed += 1;
        continue;
      }

      await this.billPeriod(subscription);
      billed += 1;
    }

    return { billed, lapsed };
  }

  /** Shared by billPeriod (cron renewal) and initiateFirstPayment ("the
   * subscriptions are not connected to Paystack" fix) — builds the
   * period's SubscriptionInvoice and calls Paystack exactly the same way
   * either time. Deliberately does NOT touch Subscription.renewsAt: the
   * two callers disagree on when that should move (immediately, for a
   * renewal already ACTIVE; only once the first payment is verified, for
   * a still-PENDING subscription that has no current period yet). */
  private async initiatePeriodPayment(subscription: BillableSubscription) {
    const periodStart = new Date();
    const periodEnd = new Date(periodStart.getTime() + BILLING_PERIOD_MS);
    const reference = `${SUBSCRIPTION_INVOICE_REFERENCE_PREFIX}${subscription.id}_${randomBytes(4).toString('hex')}`;
    const amountKobo = Math.round(Number(subscription.amount) * 100);

    const result = await this.paystack.initializeTransaction({
      email: subscription.customer.user.email ?? `${subscription.customer.user.id}@asoju.invalid`,
      amountKobo,
      reference,
      currency: subscription.currency,
      metadata: { subscriptionId: subscription.id },
    });

    const invoice = await this.prisma.subscriptionInvoice.create({
      data: {
        subscriptionId: subscription.id,
        periodStart,
        periodEnd,
        amount: subscription.amount,
        currency: subscription.currency,
        paystackReference: reference,
      },
    });

    return { invoice, authorizationUrl: result.authorizationUrl, reference, dryRun: result.dryRun };
  }

  private async billPeriod(subscription: BillableSubscription) {
    const { invoice, authorizationUrl, dryRun } = await this.initiatePeriodPayment(subscription);

    await this.prisma.subscription.update({ where: { id: subscription.id }, data: { renewsAt: invoice.periodEnd } });

    await this.audit.record({
      actorType: 'system',
      action: 'concierge.subscription_billed',
      metadata: { subscriptionId: subscription.id, invoiceId: invoice.id, reference: invoice.paystackReference, dryRun },
    });
    await this.notifications.notify(
      subscription.customer.userId,
      'Your Concierge subscription is due for renewal',
      dryRun
        ? `Your next Concierge payment of ${subscription.currency} ${Number(subscription.amount).toLocaleString()} is due — a real payment link will appear here once Paystack is configured.`
        : `Your next Concierge payment of ${subscription.currency} ${Number(subscription.amount).toLocaleString()} is ready — complete it at ${authorizationUrl}`,
    );

    return invoice;
  }

  /** "The subscriptions are not connected to Paystack" fix — called from
   * ConciergeService.subscribe() right after creating a PENDING
   * subscription, so signing up actually requires a real payment before
   * any benefit (SC grant, discount, eligible-request cap) is usable.
   * Returns the checkout link for the frontend to redirect to; the
   * subscription only becomes ACTIVE once handleVerifiedSubscriptionPayment
   * below confirms payment via the webhook. */
  async initiateFirstPayment(subscription: BillableSubscription) {
    const { authorizationUrl, reference, dryRun } = await this.initiatePeriodPayment(subscription);
    return { authorizationUrl, reference, dryRun };
  }

  /** Called only from the PaystackWebhookGuard-protected route, after
   * signature verification, for a `subinv_` reference. */
  async handleVerifiedSubscriptionPayment(reference: string, amountKobo: number) {
    const invoice = await this.prisma.subscriptionInvoice.findUnique({
      where: { paystackReference: reference },
      include: { subscription: { include: { customer: true } } },
    });
    if (!invoice) throw new NotFoundException(`No subscription invoice pending for reference ${reference}`);

    const expectedKobo = Math.round(Number(invoice.amount) * 100);
    if (expectedKobo !== amountKobo) {
      this.logger.error(`Paystack amount mismatch for ${reference}: expected ${expectedKobo}kobo, got ${amountKobo}kobo`);
      throw new BadRequestException('Payment amount does not match subscription invoice');
    }
    if (invoice.status === PaymentStatus.PAID) {
      return invoice; // webhooks can be delivered more than once
    }

    const updated = await this.prisma.subscriptionInvoice.update({
      where: { id: invoice.id },
      data: { status: PaymentStatus.PAID, paidAt: new Date() },
    });

    // "The subscriptions are not connected to Paystack" fix — a still-
    // PENDING subscription only ever reaches here on its FIRST verified
    // payment (renewals only exist for already-ACTIVE subscriptions, via
    // billPeriod), so this is the real activation moment: flip it ACTIVE
    // and start its first period now, not at signup time.
    const isFirstActivation = invoice.subscription.status === SubscriptionStatus.PENDING;
    if (isFirstActivation) {
      await this.prisma.subscription.update({
        where: { id: invoice.subscriptionId },
        data: { status: SubscriptionStatus.ACTIVE, renewsAt: invoice.periodEnd },
      });
      await this.audit.record({
        actorType: 'system',
        action: 'concierge.subscribed',
        metadata: { subscriptionId: invoice.subscriptionId, subscriptionInvoiceId: invoice.id, reference },
      });
    }

    // P0 Technical Build Spec Section 18: "GRANT | Monthly membership SC"
    // — granted on confirmed payment, not at invoice-creation time, so a
    // renewal (or a first period) that never gets paid never hands out
    // free SC that would otherwise need clawing back.
    const plan = invoice.subscription.plan as MembershipPlan;
    const planConfig = await this.planConfig.getConfig(plan);
    await this.scLedger.grant(invoice.subscriptionId, planConfig.scGrantUsd);

    await this.audit.record({
      actorType: 'system',
      action: 'concierge.subscription_payment_verified',
      metadata: { subscriptionInvoiceId: invoice.id, reference },
    });
    await this.notifications.notify(
      invoice.subscription.customer.userId,
      isFirstActivation ? 'Welcome to ASOJU Concierge' : 'Concierge payment received',
      isFirstActivation
        ? 'Thanks — your payment went through and your Concierge subscription is now active.'
        : 'Thanks — your Concierge subscription is active for another period.',
    );

    return updated;
  }

  /** Same "record it, tell the customer, don't silently drop it" fix as
   * CommerceService.handleFailedCasePayment, for the subscription-billing
   * side of the same webhook endpoint. */
  async handleFailedSubscriptionPayment(reference: string, gatewayResponse?: string) {
    const invoice = await this.prisma.subscriptionInvoice.findUnique({
      where: { paystackReference: reference },
      include: { subscription: { include: { customer: true } } },
    });
    if (!invoice) throw new NotFoundException(`No subscription invoice pending for reference ${reference}`);

    if (invoice.status === PaymentStatus.PAID || invoice.status === PaymentStatus.FAILED) {
      return invoice; // never downgrade a paid record; don't double-record a failure
    }

    const updated = await this.prisma.subscriptionInvoice.update({
      where: { id: invoice.id },
      data: { status: PaymentStatus.FAILED },
    });

    // A failed renewal is handled entirely by the next day's lapse sweep
    // (runBillingSweep already lapses an ACTIVE subscription whose last
    // invoice didn't get paid). A failed *first* payment has no sweep
    // watching it (PENDING subscriptions aren't in that query at all) —
    // cancel it directly so the customer isn't stuck and subscribe() lets
    // them cleanly try again instead of hitting "Already subscribed".
    const isFirstPaymentFailure = invoice.subscription.status === SubscriptionStatus.PENDING;
    if (isFirstPaymentFailure) {
      await this.prisma.subscription.update({
        where: { id: invoice.subscriptionId },
        data: { status: SubscriptionStatus.CANCELLED, cancelledAt: new Date() },
      });
    }

    await this.audit.record({
      actorType: 'system',
      action: 'concierge.subscription_payment_failed',
      metadata: { subscriptionInvoiceId: invoice.id, reference, gatewayResponse, cancelledPendingSubscription: isFirstPaymentFailure },
    });
    await this.notifications.notify(
      invoice.subscription.customer.userId,
      isFirstPaymentFailure ? 'Concierge signup payment did not go through' : 'Concierge payment did not go through',
      isFirstPaymentFailure
        ? `Your Concierge signup payment wasn't successful${gatewayResponse ? ` (${gatewayResponse})` : ''} — you can try subscribing again any time.`
        : `Your Concierge renewal payment wasn't successful${gatewayResponse ? ` (${gatewayResponse})` : ''} — it will be retried at your next billing date, or contact us to pay now.`,
    );

    return updated;
  }

  async listInvoicesForCustomer(customerId: string) {
    return this.prisma.subscriptionInvoice.findMany({
      where: { subscription: { customerId } },
      orderBy: { createdAt: 'desc' },
    });
  }
}

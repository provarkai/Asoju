import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { MembershipPlan, PaymentStatus, Prisma, SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PaystackService } from '../payments/paystack.service';
import { ScLedgerService } from './sc-ledger.service';
import { MEMBERSHIP_PLANS } from './membership-plans';

/** Reference prefix distinguishing subscription-billing Paystack references
 * from case-invoice ones (CASE_INVOICE_REFERENCE_PREFIX in commerce.service)
 * so the one webhook endpoint can route both. */
export const SUBSCRIPTION_INVOICE_REFERENCE_PREFIX = 'subinv_';

const BILLING_PERIOD_DAYS = 30;

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

  private async billPeriod(subscription: BillableSubscription) {
    const periodStart = new Date();
    const periodEnd = new Date(periodStart.getTime() + BILLING_PERIOD_DAYS * 24 * 60 * 60 * 1000);
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

    await this.prisma.subscription.update({ where: { id: subscription.id }, data: { renewsAt: periodEnd } });

    await this.audit.record({
      actorType: 'system',
      action: 'concierge.subscription_billed',
      metadata: { subscriptionId: subscription.id, invoiceId: invoice.id, reference, dryRun: result.dryRun },
    });
    await this.notifications.notify(
      subscription.customer.userId,
      'Your Concierge subscription is due for renewal',
      result.dryRun
        ? `Your next Concierge payment of ${subscription.currency} ${Number(subscription.amount).toLocaleString()} is due — a real payment link will appear here once Paystack is configured.`
        : `Your next Concierge payment of ${subscription.currency} ${Number(subscription.amount).toLocaleString()} is ready — complete it at ${result.authorizationUrl}`,
    );

    return invoice;
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

    // P0 Technical Build Spec Section 18: "GRANT | Monthly membership SC"
    // — granted on confirmed payment, not at invoice-creation time, so a
    // renewal that never gets paid never hands out free SC that would
    // otherwise need clawing back.
    const plan = invoice.subscription.plan as MembershipPlan;
    await this.scLedger.grant(invoice.subscriptionId, MEMBERSHIP_PLANS[plan].scGrantUsd);

    await this.audit.record({
      actorType: 'system',
      action: 'concierge.subscription_payment_verified',
      metadata: { subscriptionInvoiceId: invoice.id, reference },
    });
    await this.notifications.notify(
      invoice.subscription.customer.userId,
      'Concierge payment received',
      'Thanks — your Concierge subscription is active for another period.',
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

    await this.audit.record({
      actorType: 'system',
      action: 'concierge.subscription_payment_failed',
      metadata: { subscriptionInvoiceId: invoice.id, reference, gatewayResponse },
    });
    await this.notifications.notify(
      invoice.subscription.customer.userId,
      'Concierge payment did not go through',
      `Your Concierge renewal payment wasn't successful${gatewayResponse ? ` (${gatewayResponse})` : ''} — it will be retried at your next billing date, or contact us to pay now.`,
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

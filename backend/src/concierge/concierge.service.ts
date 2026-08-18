import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CaseTier, MembershipPlan, Role, SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { ScLedgerService } from './sc-ledger.service';
import { MembershipService } from './membership.service';
import { PlanConfigService } from './plan-config.service';
import { SubscriptionBillingService } from './subscription-billing.service';
import { usdToNgnRate } from './membership-plans';

/**
 * Section 12 P1 "Concierge workflow" — the subscription/relationship-
 * management side of the two-tier pricing model (Section 2: ASOJU
 * Essential vs ASOJU Concierge). Kept deliberately simple for MVP: no
 * proration, no plan changes mid-cycle, no multiple tiers — a Subscription
 * row is the source of truth for "is this customer Concierge right now",
 * and an RM is assigned at the customer level (their whole portfolio), not
 * per case. Billing itself is NOT simplified, though — see subscribe()'s
 * own comment; a real Paystack payment gates every subscription, same as
 * every renewal and every case payment.
 */
@Injectable()
export class ConciergeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly scLedger: ScLedgerService,
    private readonly membership: MembershipService,
    private readonly planConfig: PlanConfigService,
    private readonly subscriptionBilling: SubscriptionBillingService,
  ) {}

  /** "The subscriptions are not connected to Paystack" fix — P0 Technical
   * Build Spec Section 17: Priority ($99/mo, $50 SC, 10% discount, 2
   * eligible requests/mo) or Premium ($299/mo, $150 SC, 15%, 5/mo). Locks
   * the plan's USD price and the current FX rate onto the subscription
   * row at signup time (never recomputed retroactively — see the schema
   * comment), same as before. What changed: this used to create the
   * subscription ACTIVE and grant its SC immediately, with no payment
   * step at all. It now creates it PENDING — invisible to every
   * `status: ACTIVE` check (getActiveSubscription, runBillingSweep, this
   * method's own "already subscribed" guard) — and hands back a real
   * Paystack checkout link. SubscriptionBillingService.handleVerifiedSubscriptionPayment
   * is what actually flips it ACTIVE and grants SC, only once the payment
   * is verified by webhook (Non-Negotiable #4 — the same verified-webhook-
   * only rule as every other payment in this app). */
  async subscribe(user: AuthenticatedUser, plan: MembershipPlan = MembershipPlan.PRIORITY) {
    const customer = await this.prisma.customer.findUnique({ where: { userId: user.id }, include: { user: true } });
    if (!customer) throw new NotFoundException('No customer profile for this user');

    const existing = await this.prisma.subscription.findFirst({
      where: { customerId: customer.id, status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.PENDING] } },
      orderBy: { startedAt: 'desc' },
    });
    if (existing?.status === SubscriptionStatus.ACTIVE) {
      throw new BadRequestException('Already subscribed to Concierge');
    }

    // A pending checkout for the same plan is resumed (a fresh payment
    // link on the same row) rather than piling up a second Subscription
    // every time a customer abandons Paystack checkout and clicks
    // Subscribe again. A pending checkout for a *different* plan is left
    // alone — harmless, unpaid, and never activates on its own.
    let subscription =
      existing?.status === SubscriptionStatus.PENDING && existing.plan === plan ? existing : null;

    if (!subscription) {
      const planConfig = await this.planConfig.getConfig(plan);
      const fxRate = usdToNgnRate();

      subscription = await this.prisma.subscription.create({
        data: {
          customerId: customer.id,
          tier: CaseTier.CONCIERGE,
          plan,
          status: SubscriptionStatus.PENDING,
          priceUsd: planConfig.priceUsd,
          fxRate,
          amount: Math.round(planConfig.priceUsd * fxRate),
          // renewsAt stays null — there is no current period yet; it's
          // set to the first period's end only once payment is verified.
        },
      });

      await this.audit.record({
        actorId: user.id,
        actorType: 'user',
        action: 'concierge.subscription_initiated',
        metadata: { subscriptionId: subscription.id, plan, priceUsd: planConfig.priceUsd },
      });
    }

    const { authorizationUrl, dryRun } = await this.subscriptionBilling.initiateFirstPayment({
      id: subscription.id,
      amount: subscription.amount,
      currency: subscription.currency,
      customer: { userId: customer.userId, user: { id: customer.user.id, email: customer.user.email } },
    });

    return { ...subscription, authorizationUrl, dryRun };
  }

  /** Enriched with the same computed fields the customer's Membership
   * screen and profile need — plan benefits, live SC balance, and this
   * period's eligible-request usage — so the frontend doesn't need a
   * second round trip to the SC ledger just to render a summary. */
  async getMySubscription(user: AuthenticatedUser) {
    const customer = await this.requireCustomer(user.id);
    const subscription = await this.prisma.subscription.findFirst({
      where: { customerId: customer.id },
      orderBy: { startedAt: 'desc' },
    });
    if (!subscription) return null;

    const planConfig = await this.planConfig.getConfig(subscription.plan);
    const [scBalanceUsd, eligibleUsedThisPeriod] = await Promise.all([
      this.scLedger.getBalanceUsd(subscription.id),
      this.membership.getEligibleUsageThisPeriod(subscription),
    ]);

    return {
      ...subscription,
      planConfig,
      scBalanceUsd,
      eligibleUsedThisPeriod,
      eligibleRemainingThisPeriod: Math.max(0, planConfig.eligibleRequestsPerMonth - eligibleUsedThisPeriod),
    };
  }

  /** Customer's own SC ledger — Finance Screen "SC Ledger" has the
   * cross-customer equivalent (see ScLedgerController). */
  async getMyScLedger(user: AuthenticatedUser) {
    const customer = await this.requireCustomer(user.id);
    const subscription = await this.prisma.subscription.findFirst({
      where: { customerId: customer.id },
      orderBy: { startedAt: 'desc' },
    });
    if (!subscription) return [];
    return this.scLedger.listForSubscription(subscription.id);
  }

  async cancelSubscription(user: AuthenticatedUser) {
    const customer = await this.requireCustomer(user.id);
    // Also cancellable while PENDING — a customer who wants to back out
    // before ever paying shouldn't be stuck waiting for the payment to
    // fail on its own (or told there's "no active Concierge subscription"
    // when there's clearly an unpaid one sitting there).
    const active = await this.prisma.subscription.findFirst({
      where: { customerId: customer.id, status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.PENDING] } },
      orderBy: { startedAt: 'desc' },
    });
    if (!active) throw new NotFoundException('No active Concierge subscription');

    const cancelled = await this.prisma.subscription.update({
      where: { id: active.id },
      data: { status: SubscriptionStatus.CANCELLED, cancelledAt: new Date() },
    });

    await this.audit.record({
      actorId: user.id,
      actorType: 'user',
      action: 'concierge.cancelled',
      metadata: { subscriptionId: active.id },
    });

    return cancelled;
  }

  /** Admin assigns/reassigns the RM who owns this customer's whole portfolio. */
  async assignRm(actor: AuthenticatedUser, customerId: string, rmUserId: string) {
    const [customer, rmUser] = await Promise.all([
      this.prisma.customer.findUnique({ where: { id: customerId } }),
      this.prisma.user.findUnique({ where: { id: rmUserId } }),
    ]);
    if (!customer) throw new NotFoundException('Customer not found');
    if (!rmUser || rmUser.role !== Role.RELATIONSHIP_MANAGER) {
      throw new BadRequestException('rmUserId must belong to a Relationship Manager');
    }

    const updated = await this.prisma.customer.update({
      where: { id: customerId },
      data: { assignedRmUserId: rmUserId },
    });

    await this.audit.record({
      actorId: actor.id,
      actorType: 'user',
      action: 'concierge.rm_assigned',
      metadata: { customerId, rmUserId },
    });
    await this.notifications.notify(
      customer.userId,
      'You have a dedicated relationship manager',
      "As a Concierge member, you now have a relationship manager looking after your cases.",
    );

    return updated;
  }

  /** RM's own portfolio (Section 4 — "Assigned customer portfolio (Concierge tier)"). */
  async listPortfolio(actor: AuthenticatedUser) {
    return this.prisma.customer.findMany({
      where: { assignedRmUserId: actor.id },
      include: {
        user: { select: { email: true } },
        subscriptions: { orderBy: { startedAt: 'desc' }, take: 1 },
        _count: { select: { serviceCases: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Admin-facing directory for the "assign RM" picker. */
  async listCustomers() {
    return this.prisma.customer.findMany({
      include: {
        user: { select: { email: true } },
        assignedRm: { select: { id: true, email: true } },
        subscriptions: { orderBy: { startedAt: 'desc' }, take: 1 },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  async listRelationshipManagers() {
    return this.prisma.user.findMany({
      where: { role: Role.RELATIONSHIP_MANAGER },
      select: { id: true, email: true },
    });
  }

  /** Shared with ConciergeController for the /me/subscription/invoices read. */
  async requireCustomerForInvoices(user: AuthenticatedUser) {
    return this.requireCustomer(user.id);
  }

  private async requireCustomer(userId: string) {
    const customer = await this.prisma.customer.findUnique({ where: { userId } });
    if (!customer) throw new NotFoundException('No customer profile for this user');
    return customer;
  }
}

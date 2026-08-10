import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, ScTransactionType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

/**
 * P0 Technical Build Spec Section 18 "SC Ledger" — "SC must be implemented
 * as a transaction ledger, not as a manually editable balance." Every
 * method here appends a row; nothing here ever does a balance UPDATE.
 * Available SC = sum(GRANT) + sum(REVERSAL) − sum(DEBIT) − sum(EXPIRY) +
 * sum(signed ADJUSTMENT) — computed fresh from the ledger every time, per
 * "Available SC = sum of valid ledger credits minus valid debits/adjustments."
 */
@Injectable()
export class ScLedgerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private signedAmount(type: ScTransactionType, amountUsd: Prisma.Decimal | number): number {
    const amt = Number(amountUsd);
    switch (type) {
      case ScTransactionType.GRANT:
      case ScTransactionType.REVERSAL:
        return Math.abs(amt);
      case ScTransactionType.DEBIT:
      case ScTransactionType.EXPIRY:
        return -Math.abs(amt);
      case ScTransactionType.ADJUSTMENT:
        return amt; // signed at the source — see adjust()
    }
  }

  async getBalanceUsd(subscriptionId: string): Promise<number> {
    const entries = await this.prisma.scLedgerEntry.findMany({
      where: { subscriptionId },
      select: { type: true, amountUsd: true },
    });
    return entries.reduce((sum, e) => sum + this.signedAmount(e.type, e.amountUsd), 0);
  }

  async listForSubscription(subscriptionId: string) {
    return this.prisma.scLedgerEntry.findMany({
      where: { subscriptionId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Monthly membership grant — see SubscriptionBillingService, called on
   * subscribe and on each successful renewal. */
  async grant(subscriptionId: string, amountUsd: number) {
    const entry = await this.prisma.scLedgerEntry.create({
      data: { subscriptionId, type: ScTransactionType.GRANT, amountUsd: Math.abs(amountUsd) },
    });
    await this.audit.record({
      actorType: 'system',
      action: 'sc.granted',
      metadata: { subscriptionId, amountUsd },
    });
    return entry;
  }

  /**
   * Never debits beyond available balance — caps at whatever's left and
   * reports how much was actually applied. P0 Technical Build Spec: "SC |
   * Insufficient SC → Do not debit beyond available balance; use normal
   * payment/quote flow." Requesting more than is available is not an
   * error here — the caller (MembershipService) folds the shortfall into
   * the normal payable amount instead.
   */
  async debit(
    subscriptionId: string,
    requestedUsd: number,
    opts: { caseId?: string; quoteId?: string; fxRate: number },
  ): Promise<{ appliedUsd: number; appliedNgn: number }> {
    if (requestedUsd <= 0) return { appliedUsd: 0, appliedNgn: 0 };
    const available = await this.getBalanceUsd(subscriptionId);
    const appliedUsd = Math.max(0, Math.min(requestedUsd, available));
    if (appliedUsd <= 0) return { appliedUsd: 0, appliedNgn: 0 };

    const appliedNgn = Math.round(appliedUsd * opts.fxRate);
    await this.prisma.scLedgerEntry.create({
      data: {
        subscriptionId,
        type: ScTransactionType.DEBIT,
        amountUsd: appliedUsd,
        caseId: opts.caseId,
        quoteId: opts.quoteId,
        fxRateApplied: opts.fxRate,
        amountNgn: appliedNgn,
      },
    });
    await this.audit.record({
      caseId: opts.caseId,
      actorType: 'system',
      action: 'sc.debited',
      metadata: { subscriptionId, appliedUsd, appliedNgn, fxRate: opts.fxRate, quoteId: opts.quoteId },
    });
    return { appliedUsd, appliedNgn };
  }

  /** Reverses a prior debit (e.g. a cancelled/refunded case) — always
   * requires a reason and an authorized actor, never a silent balance edit. */
  async reverse(subscriptionId: string, amountUsd: number, reason: string, actorId: string, caseId?: string) {
    if (!reason?.trim()) throw new BadRequestException('reason is required for a reversal');
    const entry = await this.prisma.scLedgerEntry.create({
      data: { subscriptionId, type: ScTransactionType.REVERSAL, amountUsd: Math.abs(amountUsd), reason, actorId, caseId },
    });
    await this.audit.record({
      actorId,
      actorType: 'user',
      action: 'sc.reversed',
      metadata: { subscriptionId, amountUsd, reason, caseId },
    });
    return entry;
  }

  /** Signed correction (amountUsd may be negative) — the one place a
   * human can move the balance directly, and only with a reason and an
   * authorized actor (Finance/Admin — enforced by the controller's
   * @Roles, not here). */
  async adjust(subscriptionId: string, amountUsd: number, reason: string, actorId: string) {
    if (!reason?.trim()) throw new BadRequestException('reason is required for a manual adjustment');
    if (amountUsd === 0) throw new BadRequestException('adjustment amount cannot be zero');
    const entry = await this.prisma.scLedgerEntry.create({
      data: { subscriptionId, type: ScTransactionType.ADJUSTMENT, amountUsd, reason, actorId },
    });
    await this.audit.record({
      actorId,
      actorType: 'user',
      action: 'sc.adjusted',
      metadata: { subscriptionId, amountUsd, reason },
    });
    return entry;
  }
}

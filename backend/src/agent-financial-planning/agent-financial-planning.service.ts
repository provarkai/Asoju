import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';

// ═══════════════════════════════════════════════════════════════════════════════
// Agent Financial Planning — inherited from FieldForce's financial-planning.ts
// ═══════════════════════════════════════════════════════════════════════════════
// Turns an agent's real WalletEntry history (the same ledger #38's
// AgentWalletService.recordEarning() writes on every Finance-recorded, QC-
// passed case) into three things field agents in the gig economy
// consistently lack: a forward-looking earnings projection, a savings
// plan, and a plain-language Nigerian PAYE tax estimate. Adapted from
// FieldForce's version: this app's WalletEntry.amount is a Prisma Decimal
// (ledger stores Naira, same as FieldForce's plain-number amounts, just a
// different column type), and the earning type here is 'EARNING' — #38's
// deliberately simpler two-type ledger — rather than FieldForce's
// 'MISSION_EARNING'.
//
// Tax estimate caveat, same "confirmed vs not" honesty this codebase
// already applies elsewhere: the band table below is Nigeria's
// long-standing personal income tax structure (Consolidated Relief
// Allowance + graduated bands), published and stable, not a guess — but
// this function is an *informational estimate* for an agent's own
// planning, not certified tax advice, and doesn't model reliefs specific
// to an individual's circumstances (pension contributions, NHF, etc.).

// ─── Earnings History ───────────────────────────────────────────────────

export interface MonthlyEarnings {
  month: string; // "2026-01"
  totalNaira: number;
  earningCount: number;
}

// ─── Earnings Projection ────────────────────────────────────────────────

export interface EarningsProjection {
  basis: 'no_history' | 'trailing_average';
  monthsOfHistory: number;
  trailingAverageMonthlyNaira: number;
  projectedNextMonthNaira: number;
  projectedNextQuarterNaira: number;
  projectedNextYearNaira: number;
}

/** Simple trailing-average projection — no ML, no seasonality modelling.
 * Deliberately conservative and easy to explain to an agent: "you've
 * averaged ₦X/month over your last N months, so at that pace you'd earn
 * ~₦Y over the next quarter/year." Uses whatever history exists (down to
 * a single month) rather than requiring a fixed window, since a newer
 * agent with 2 months of data still benefits from a projection. */
export function projectEarnings(history: MonthlyEarnings[]): EarningsProjection {
  if (history.length === 0) {
    return {
      basis: 'no_history',
      monthsOfHistory: 0,
      trailingAverageMonthlyNaira: 0,
      projectedNextMonthNaira: 0,
      projectedNextQuarterNaira: 0,
      projectedNextYearNaira: 0,
    };
  }

  const totalNaira = history.reduce((sum, m) => sum + m.totalNaira, 0);
  const average = Math.round(totalNaira / history.length);

  return {
    basis: 'trailing_average',
    monthsOfHistory: history.length,
    trailingAverageMonthlyNaira: average,
    projectedNextMonthNaira: average,
    projectedNextQuarterNaira: average * 3,
    projectedNextYearNaira: average * 12,
  };
}

// ─── Savings Plan ───────────────────────────────────────────────────────

export interface SavingsPlan {
  recommendedRatePercent: number;
  recommendedMonthlySavingsNaira: number;
  projected6MonthNaira: number;
  projected12MonthNaira: number;
}

const DEFAULT_SAVINGS_RATE_PERCENT = 15;

/** A flat recommended-savings-rate model, not a budgeting engine — gig
 * income is irregular, so this intentionally works off the same trailing
 * average the earnings projection uses rather than asking the agent to
 * enter expenses. 15% is a commonly-cited starting point for irregular
 * income (higher than a salaried worker's typical 10%, to build a buffer
 * against slow months); an agent can plan around a different rate, this
 * is just the default suggestion. */
export function buildSavingsPlan(
  trailingAverageMonthlyNaira: number,
  ratePercent: number = DEFAULT_SAVINGS_RATE_PERCENT,
): SavingsPlan {
  const monthly = Math.round((trailingAverageMonthlyNaira * ratePercent) / 100);
  return {
    recommendedRatePercent: ratePercent,
    recommendedMonthlySavingsNaira: monthly,
    projected6MonthNaira: monthly * 6,
    projected12MonthNaira: monthly * 12,
  };
}

// ─── Tax Estimate (Nigerian PAYE, informational only) ──────────────────

export interface TaxBandBreakdown {
  bandLabel: string;
  taxableInBandNaira: number;
  ratePercent: number;
  taxInBandNaira: number;
}

export interface TaxEstimate {
  grossAnnualIncomeNaira: number;
  consolidatedReliefAllowanceNaira: number;
  taxableIncomeNaira: number;
  bands: TaxBandBreakdown[];
  totalEstimatedTaxNaira: number;
  effectiveRatePercent: number;
  disclaimer: string;
}

// Nigeria's graduated PAYE bands (Personal Income Tax Act, as amended) —
// applied to taxable income after the Consolidated Relief Allowance (CRA)
// is deducted. Order matters: each band only taxes the income that falls
// within it, not the whole taxable amount.
const PAYE_BANDS: { limitNaira: number | null; ratePercent: number; label: string }[] = [
  { limitNaira: 300_000, ratePercent: 7, label: 'First ₦300,000' },
  { limitNaira: 300_000, ratePercent: 11, label: 'Next ₦300,000' },
  { limitNaira: 500_000, ratePercent: 15, label: 'Next ₦500,000' },
  { limitNaira: 500_000, ratePercent: 19, label: 'Next ₦500,000' },
  { limitNaira: 1_600_000, ratePercent: 21, label: 'Next ₦1,600,000' },
  { limitNaira: null, ratePercent: 24, label: 'Above ₦3,200,000' }, // remainder
];

/** CRA = higher of ₦200,000 or 1% of gross income, plus 20% of gross
 * income — the standard first deduction before PAYE bands apply. */
function consolidatedReliefAllowance(grossAnnualIncomeNaira: number): number {
  const flatOrPercent = Math.max(200_000, grossAnnualIncomeNaira * 0.01);
  return Math.round(flatOrPercent + grossAnnualIncomeNaira * 0.2);
}

/** Estimates annual PAYE liability from a projected annual income figure.
 * Purely informational — see the file-level caveat. Never throws on
 * unusual input; a zero/negative income just yields a zero estimate. */
export function estimateAnnualTax(grossAnnualIncomeNaira: number): TaxEstimate {
  const gross = Math.max(0, Math.round(grossAnnualIncomeNaira));
  const cra = consolidatedReliefAllowance(gross);
  const taxableIncome = Math.max(0, gross - cra);

  const bands: TaxBandBreakdown[] = [];
  let remaining = taxableIncome;
  let totalTax = 0;

  for (const band of PAYE_BANDS) {
    if (remaining <= 0) break;
    const taxableInBand = band.limitNaira === null ? remaining : Math.min(remaining, band.limitNaira);
    const taxInBand = Math.round((taxableInBand * band.ratePercent) / 100);
    bands.push({
      bandLabel: band.label,
      taxableInBandNaira: taxableInBand,
      ratePercent: band.ratePercent,
      taxInBandNaira: taxInBand,
    });
    totalTax += taxInBand;
    remaining -= taxableInBand;
  }

  return {
    grossAnnualIncomeNaira: gross,
    consolidatedReliefAllowanceNaira: cra,
    taxableIncomeNaira: taxableIncome,
    bands,
    totalEstimatedTaxNaira: totalTax,
    effectiveRatePercent: gross > 0 ? Math.round((totalTax / gross) * 1000) / 10 : 0,
    disclaimer:
      'Informational estimate only, based on standard Nigerian PAYE bands and the Consolidated Relief Allowance. Not certified tax advice — actual liability depends on your full circumstances (other reliefs, deductions, income sources).',
  };
}

// ─── Full Plan ───────────────────────────────────────────────────────────

export interface FinancialPlan {
  history: MonthlyEarnings[];
  projection: EarningsProjection;
  savingsPlan: SavingsPlan;
  taxEstimate: TaxEstimate;
}

@Injectable()
export class AgentFinancialPlanningService {
  constructor(private readonly prisma: PrismaService) {}

  /** Buckets this agent's EARNING wallet entries by calendar month, oldest
   * first. Only counts entries actually posted to the ledger — never
   * projected/pending figures — so this is ground truth to project from. */
  async getMonthlyEarningsHistory(agentId: string, monthsBack = 6): Promise<MonthlyEarnings[]> {
    const since = new Date();
    since.setMonth(since.getMonth() - monthsBack);
    since.setDate(1);
    since.setHours(0, 0, 0, 0);

    const entries = await this.prisma.walletEntry.findMany({
      where: { agentId, type: 'EARNING', createdAt: { gte: since } },
      select: { amount: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });

    const byMonth = new Map<string, { totalNaira: number; earningCount: number }>();
    for (const entry of entries) {
      const key = `${entry.createdAt.getFullYear()}-${String(entry.createdAt.getMonth() + 1).padStart(2, '0')}`;
      const bucket = byMonth.get(key) ?? { totalNaira: 0, earningCount: 0 };
      bucket.totalNaira += Number(entry.amount);
      bucket.earningCount += 1;
      byMonth.set(key, bucket);
    }

    return [...byMonth.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, v]) => ({ month, ...v }));
  }

  async getFinancialPlan(actor: AuthenticatedUser, agentId: string, monthsBack = 6): Promise<FinancialPlan> {
    const agent = await this.prisma.agent.findUnique({ where: { id: agentId } });
    if (!agent) throw new NotFoundException('Agent not found');

    const isOps = actor.role === Role.FINANCE || actor.role === Role.ADMIN || actor.role === Role.SUPER_ADMIN;
    const isOwnPlan = agent.userId === actor.id;
    if (!isOps && !isOwnPlan) {
      throw new ForbiddenException('Not authorised to view this agent’s financial plan');
    }

    const history = await this.getMonthlyEarningsHistory(agentId, monthsBack);
    const projection = projectEarnings(history);
    const savingsPlan = buildSavingsPlan(projection.trailingAverageMonthlyNaira);
    const taxEstimate = estimateAnnualTax(projection.projectedNextYearNaira);

    return { history, projection, savingsPlan, taxEstimate };
  }
}

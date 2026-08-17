import { Injectable } from '@nestjs/common';
import { JournalLineDirection, LedgerAccountType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type TxClient = Prisma.TransactionClient | PrismaService;

// ═══════════════════════════════════════════════════════════════════════════════
// Double-entry ledger for agent payouts — see LedgerAccount/JournalEntry/
// JournalLine in schema.prisma for the "why not FieldForce's postings
// verbatim" note. WalletAccount/WalletEntry (#38) stay the read model;
// this is the reconcilable source of truth underneath it.
// ═══════════════════════════════════════════════════════════════════════════════

const ACCOUNTS = [
  {
    code: 'AGENT_COMPENSATION_EXPENSE',
    name: 'Agent Compensation Expense',
    type: LedgerAccountType.EXPENSE,
    description: 'Cost recognized when a field agent earns on a QC-passed case',
  },
  {
    code: 'AGENT_PAYOUT_PAYABLE',
    name: 'Agent Payout Payable',
    type: LedgerAccountType.LIABILITY,
    description: 'Amount owed to field agents that has not yet been paid out',
  },
  {
    code: 'OPERATING_CASH',
    name: 'Operating Cash',
    type: LedgerAccountType.ASSET,
    description: 'Cash actually disbursed to agents on payout',
  },
] as const;

type AccountCode = (typeof ACCOUNTS)[number]['code'];

interface JournalLineInput {
  accountCode: AccountCode;
  direction: JournalLineDirection;
  amount: number | Prisma.Decimal;
  description?: string;
}

@Injectable()
export class LedgerService {
  constructor(private readonly prisma: PrismaService) {}

  /** Idempotent upsert of the chart of accounts — cheap enough to call
   * before every post rather than requiring a separate boot step. */
  async ensureChartOfAccounts(tx: TxClient = this.prisma) {
    for (const account of ACCOUNTS) {
      await tx.ledgerAccount.upsert({ where: { code: account.code }, create: account, update: {} });
    }
  }

  /**
   * Posts a balanced journal entry, or throws and writes nothing.
   * CORE INVARIANT: total DEBIT amount === total CREDIT amount. Postgres
   * has no native constraint for "these child rows sum to zero across two
   * groups," so this method is the only enforcement there is — every
   * posting MUST go through here, never a direct `journalEntry.create`.
   *
   * `tx` is required (not defaulted) deliberately: every real call site
   * posts inside the same transaction as the WalletEntry/Payout row it
   * backs, so the read model and the ledger can never diverge on a
   * partial failure. Idempotent on `idempotencyKey` — replaying the same
   * real-world event (a retried request) returns the original entry
   * instead of double-posting.
   */
  async postJournalEntry(
    tx: TxClient,
    params: {
      idempotencyKey: string;
      entityType: string;
      entityId?: string;
      agentId?: string;
      description?: string;
      lines: JournalLineInput[];
    },
  ) {
    const { idempotencyKey, lines } = params;

    if (lines.length < 2) {
      throw new Error(`Journal entry ${idempotencyKey} needs at least 2 lines, got ${lines.length}`);
    }
    if (lines.some((l) => Number(l.amount) <= 0)) {
      throw new Error(`Journal entry ${idempotencyKey} has a non-positive line amount`);
    }
    const totalDebits = lines
      .filter((l) => l.direction === JournalLineDirection.DEBIT)
      .reduce((sum, l) => sum + Number(l.amount), 0);
    const totalCredits = lines
      .filter((l) => l.direction === JournalLineDirection.CREDIT)
      .reduce((sum, l) => sum + Number(l.amount), 0);
    if (totalDebits === 0 || totalCredits === 0) {
      throw new Error(`Journal entry ${idempotencyKey} must have at least one debit line and one credit line`);
    }
    if (totalDebits !== totalCredits) {
      throw new Error(
        `Journal entry ${idempotencyKey} does not balance: debits=${totalDebits}, credits=${totalCredits}`,
      );
    }

    const existing = await tx.journalEntry.findUnique({ where: { idempotencyKey } });
    if (existing) return existing;

    await this.ensureChartOfAccounts(tx);
    const accounts = await tx.ledgerAccount.findMany({
      where: { code: { in: lines.map((l) => l.accountCode) } },
    });
    const accountIdByCode = new Map(accounts.map((a) => [a.code, a.id]));

    return tx.journalEntry.create({
      data: {
        idempotencyKey: params.idempotencyKey,
        entityType: params.entityType,
        entityId: params.entityId,
        agentId: params.agentId,
        description: params.description,
        lines: {
          create: lines.map((l) => ({
            accountId: accountIdByCode.get(l.accountCode)!,
            direction: l.direction,
            amount: l.amount,
            description: l.description,
          })),
        },
      },
      include: { lines: true },
    });
  }

  /** Called from AgentWalletService.recordEarning, in the same
   * transaction as the WalletEntry it backs.
   *   DEBIT  AGENT_COMPENSATION_EXPENSE — ASOJU incurs a labor cost
   *   CREDIT AGENT_PAYOUT_PAYABLE       — ASOJU now owes the agent this amount */
  postEarning(
    tx: TxClient,
    params: { walletEntryId: string; agentId: string; amount: number | Prisma.Decimal; caseId: string },
  ) {
    return this.postJournalEntry(tx, {
      idempotencyKey: `EARNING_${params.walletEntryId}`,
      entityType: 'WalletEntry',
      entityId: params.walletEntryId,
      agentId: params.agentId,
      description: `Agent earning recorded on case ${params.caseId}`,
      lines: [
        { accountCode: 'AGENT_COMPENSATION_EXPENSE', direction: JournalLineDirection.DEBIT, amount: params.amount },
        { accountCode: 'AGENT_PAYOUT_PAYABLE', direction: JournalLineDirection.CREDIT, amount: params.amount },
      ],
    });
  }

  /** Called from AgentWalletService.recordPayout, in the same
   * transaction as the Payout it backs.
   *   DEBIT  AGENT_PAYOUT_PAYABLE — liability to this agent is cleared
   *   CREDIT OPERATING_CASH      — cash leaves ASOJU's account */
  postPayout(tx: TxClient, params: { payoutId: string; agentId: string; amount: number | Prisma.Decimal }) {
    return this.postJournalEntry(tx, {
      idempotencyKey: `PAYOUT_${params.payoutId}`,
      entityType: 'Payout',
      entityId: params.payoutId,
      agentId: params.agentId,
      description: `Agent payout ${params.payoutId}`,
      lines: [
        { accountCode: 'AGENT_PAYOUT_PAYABLE', direction: JournalLineDirection.DEBIT, amount: params.amount },
        { accountCode: 'OPERATING_CASH', direction: JournalLineDirection.CREDIT, amount: params.amount },
      ],
    });
  }

  /** Ops-facing read: one row per account, debits/credits/balance. If
   * every posting ever went through postJournalEntry, sum(all debits)
   * always equals sum(all credits) across the whole ledger — the
   * reconciliation check this whole thing exists to make possible. */
  async getTrialBalance() {
    const accounts = await this.prisma.ledgerAccount.findMany({
      include: { lines: true },
      orderBy: { code: 'asc' },
    });

    return accounts.map((account) => {
      const debits = account.lines
        .filter((l) => l.direction === JournalLineDirection.DEBIT)
        .reduce((sum, l) => sum + Number(l.amount), 0);
      const credits = account.lines
        .filter((l) => l.direction === JournalLineDirection.CREDIT)
        .reduce((sum, l) => sum + Number(l.amount), 0);
      const normalBalanceIsDebit =
        account.type === LedgerAccountType.ASSET || account.type === LedgerAccountType.EXPENSE;

      return {
        code: account.code,
        name: account.name,
        type: account.type,
        totalDebits: debits,
        totalCredits: credits,
        balance: normalBalanceIsDebit ? debits - credits : credits - debits,
      };
    });
  }

  /** Ops-facing read: the subsidiary detail for one agent — every journal
   * entry that named them, across both control accounts. */
  getAgentLedger(agentId: string, limit = 50) {
    return this.prisma.journalEntry.findMany({
      where: { agentId },
      include: { lines: { include: { account: true } } },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }
}

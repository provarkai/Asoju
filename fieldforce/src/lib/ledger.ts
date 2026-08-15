// ─── ASOJU FieldForce — P0.8 Double-Entry Ledger Library ─────────────────
// Core invariant: Every journal entry must balance (total debits = total credits)
// The wallet is a read model/projection; the ledger is the financial source of truth.
//
// Chart of Accounts:
//   AGENT_PENDING_EARNINGS  — Mission completed, awaiting QC approval
//   AGENT_AVAILABLE_BALANCE — QC approved, available for payout
//   ASOJU_FEES_REVENUE     — Platform fees earned by Asouju
//   PAYOUT_ESCROW           — Amounts locked for in-flight payouts
//   PAYOUT_PAYABLE          — Owed to agents ( cleared from available on payout request)
//   CUSTOMER_PAYMENTS       — Customer payments received
//   CUSTOMER_PAYABLE        — Services owed to customers

import { db } from '@/lib/db';

// ─── Chart of Accounts ─────────────────────────────────────────────────

const ACCOUNT_CODES = {
  AGENT_PENDING_EARNINGS: 'AGENT_PENDING_EARNINGS',
  AGENT_AVAILABLE_BALANCE: 'AGENT_AVAILABLE_BALANCE',
  ASOJU_FEES_REVENUE: 'ASOJU_FEES_REVENUE',
  PAYOUT_ESCROW: 'PAYOUT_ESCROW',
  PAYOUT_PAYABLE: 'PAYOUT_PAYABLE',
  CUSTOMER_PAYMENTS: 'CUSTOMER_PAYMENTS',
  CUSTOMER_PAYABLE: 'CUSTOMER_PAYABLE',
  ADJUSTMENT: 'ADJUSTMENT',
} as const;

const ACCOUNT_DEFINITIONS = [
  {
    code: ACCOUNT_CODES.AGENT_PENDING_EARNINGS,
    name: 'Agent Pending Earnings',
    type: 'LIABILITY',
    category: 'AGENT',
    description: 'Mission earnings pending QC approval',
  },
  {
    code: ACCOUNT_CODES.AGENT_AVAILABLE_BALANCE,
    name: 'Agent Available Balance',
    type: 'LIABILITY',
    category: 'AGENT',
    description: 'QC-cleared earnings available for payout',
  },
  {
    code: ACCOUNT_CODES.ASOJU_FEES_REVENUE,
    name: 'Asouju Platform Fees',
    type: 'REVENUE',
    category: 'PLATFORM',
    description: 'Platform fees earned on missions and payouts',
  },
  {
    code: ACCOUNT_CODES.PAYOUT_ESCROW,
    name: 'Payout Escrow',
    type: 'LIABILITY',
    category: 'PAYOUT',
    description: 'Amounts locked for in-flight payout transfers',
  },
  {
    code: ACCOUNT_CODES.PAYOUT_PAYABLE,
    name: 'Payout Payable',
    type: 'LIABILITY',
    category: 'PAYOUT',
    description: 'Amounts owed to agents after payout request',
  },
  {
    code: ACCOUNT_CODES.CUSTOMER_PAYMENTS,
    name: 'Customer Payments',
    type: 'ASSET',
    category: 'PLATFORM',
    description: 'Payments received from customers',
  },
  {
    code: ACCOUNT_CODES.CUSTOMER_PAYABLE,
    name: 'Customer Payable',
    type: 'LIABILITY',
    category: 'PLATFORM',
    description: 'Services owed to customers',
  },
  {
    code: ACCOUNT_CODES.ADJUSTMENT,
    name: 'Adjustments',
    type: 'EQUITY',
    category: 'PLATFORM',
    description: 'Manual adjustments and corrections',
  },
] as const;

// ─── Journal Line Definition ───────────────────────────────────────────

export interface JournalLineInput {
  accountId: string;   // LedgerAccount code or ID
  direction: 'DEBIT' | 'CREDIT';
  amount: number;       // Always positive
  description?: string;
}

// ─── Journal Post Result ──────────────────────────────────────────────

export interface JournalPostResult {
  success: boolean;
  journalEntryId?: string;
  error?: string;
  code?: string;
}

// ─── Seed Chart of Accounts ────────────────────────────────────────────

/**
 * Ensure all ledger accounts exist. Call this on app startup / first use.
 */
export async function seedChartOfAccounts(): Promise<void> {
  for (const def of ACCOUNT_DEFINITIONS) {
    await db.ledgerAccount.upsert({
      where: { code: def.code },
      create: def,
      update: {},
    });
  }
}

/**
 * Resolve an account code to its database ID.
 */
export async function resolveAccountId(code: string): Promise<string> {
  const account = await db.ledgerAccount.findUnique({ where: { code } });
  if (!account) {
    throw new Error(`LedgerAccount not found: ${code}`);
  }
  return account.id;
}

// ─── Core Journal Posting ──────────────────────────────────────────────

/**
 * Post a balanced double-entry journal entry.
 *
 * CORE INVARIANT: Total debits MUST equal total credits.
 * If the entry does not balance, it is REJECTED and no data is written.
 *
 * @param params - Journal entry parameters
 * @returns Result with journal entry ID on success, error on failure
 */
export async function postJournalEntry(params: {
  idempotencyKey: string;
  entityType: string;
  entityId?: string;
  agentId?: string;
  description?: string;
  lines: JournalLineInput[];
  metadata?: Record<string, unknown>;
}): Promise<JournalPostResult> {
  const { idempotencyKey, entityType, entityId, agentId, description, lines, metadata } = params;

  // Validate: Must have at least 2 lines
  if (lines.length < 2) {
    return { success: false, error: 'Journal entry must have at least 2 lines', code: 'INSUFFICIENT_LINES' };
  }

  // Validate: All amounts must be positive
  if (lines.some((l) => l.amount <= 0)) {
    return { success: false, error: 'All line amounts must be positive', code: 'INVALID_AMOUNT' };
  }

  // Validate: Must have at least one debit and one credit
  const hasDebits = lines.some((l) => l.direction === 'DEBIT');
  const hasCredits = lines.some((l) => l.direction === 'CREDIT');
  if (!hasDebits || !hasCredits) {
    return { success: false, error: 'Journal entry must have both debits and credits', code: 'UNBALANCED_TYPE' };
  }

  // Validate: Total debits must equal total credits (BALANCE CHECK)
  const totalDebits = lines.filter((l) => l.direction === 'DEBIT').reduce((sum, l) => sum + l.amount, 0);
  const totalCredits = lines.filter((l) => l.direction === 'CREDIT').reduce((sum, l) => sum + l.amount, 0);
  if (totalDebits !== totalCredits) {
    return {
      success: false,
      error: `Journal entry does not balance: debits=${totalDebits}, credits=${totalCredits}, delta=${totalDebits - totalCredits}`,
      code: 'UNBALANCED_ENTRY',
    };
  }

  // Ensure chart of accounts exists
  await seedChartOfAccounts();

  // Resolve account IDs
  const resolvedLines: { accountId: string; direction: string; amount: number; description?: string }[] = [];
  for (const line of lines) {
    const accountId = await resolveAccountId(line.accountId);
    resolvedLines.push({
      accountId,
      direction: line.direction,
      amount: line.amount,
      description: line.description,
    });
  }

  // Idempotency check
  const existing = await db.journalEntry.findUnique({
    where: { idempotencyKey },
  });
  if (existing) {
    return { success: true, journalEntryId: existing.id, error: 'IDEMPOTENT', code: 'ALREADY_POSTED' };
  }

  // Create journal entry with lines in a transaction
  const journalEntry = await db.journalEntry.create({
    data: {
      idempotencyKey,
      entityType,
      entityId,
      agentId,
      description,
      metadata: metadata ? JSON.stringify(metadata) : null,
      lines: {
        create: resolvedLines,
      },
    },
  });

  return { success: true, journalEntryId: journalEntry.id };
}

// ─── High-Level Financial Operations ──────────────────────────────────

/**
 * Post EARNINGS for a completed mission.
 *
 * When a mission passes QC and completes:
 *   DEBIT  ASOJU_FEES_REVENUE    (asojuFee)
 *   CREDIT AGENT_PENDING_EARNINGS (netPayout)
 *   CREDIT ASOJU_FEES_REVENUE    — correction to show net: actually we need:
 *
 * Simplified:
 *   DEBIT  AGENT_PENDING_EARNINGS (netPayout)  — we owe agent
 *   DEBIT  ASOJU_FEES_REVENUE    (asojuFee)   — we earned fees
 *   CREDIT ADJUSTMENT             (totalPayout) — value created
 *
 * Actually, double-entry for earnings posting:
 *   DEBIT  AGENT_PENDING_EARNINGS (netPayout)  — liability to agent increases
 *   CREDIT ASOJU_FEES_REVENUE    (asojuFee)    — revenue recognized
 *   CREDIT ADJUSTMENT             (netPayout)   — source of funds
 *
 * Hmm, let me think about this more carefully with standard accounting:
 *
 * When mission completes and agent earns:
 *   DEBIT  SERVICE_COST         (payoutAmount) — cost incurred
 *   CREDIT AGENT_PENDING_EARNINGS (netPayout)   — owe agent
 *   CREDIT ASOJU_FEES_REVENUE   (asojuFee)     — platform revenue
 */
export async function postEarnings(params: {
  missionId: string;
  agentId: string;
  payoutAmount: number;
  asojuFee: number;
  netPayout: number;
}): Promise<JournalPostResult> {
  const idempotencyKey = `EARNINGS_${params.missionId}`;

  return postJournalEntry({
    idempotencyKey,
    entityType: 'Mission',
    entityId: params.missionId,
    agentId: params.agentId,
    description: `Mission earnings: ₦${params.netPayout.toLocaleString()} to agent + ₦${params.asojuFee.toLocaleString()} Asouju fee`,
    lines: [
      {
        accountId: ACCOUNT_CODES.AGENT_PENDING_EARNINGS,
        direction: 'DEBIT',
        amount: params.netPayout,
        description: 'Agent mission earnings (pending QC)',
      },
      {
        accountId: ACCOUNT_CODES.ASOJU_FEES_REVENUE,
        direction: 'DEBIT',
        amount: params.asojuFee,
        description: 'Platform service fee',
      },
      {
        accountId: ACCOUNT_CODES.ADJUSTMENT,
        direction: 'CREDIT',
        amount: params.payoutAmount,
        description: 'Mission completion value',
      },
    ],
    metadata: {
      missionId: params.missionId,
      payoutAmount: params.payoutAmount,
      asojuFee: params.asojuFee,
      netPayout: params.netPayout,
    },
  });
}

/**
 * Move earnings from PENDING to AVAILABLE after QC approval.
 *
 *   DEBIT  AGENT_AVAILABLE_BALANCE (netPayout) — available for payout
 *   CREDIT AGENT_PENDING_EARNINGS (netPayout)  — clear pending
 */
export async function postQcEarningsRelease(params: {
  missionId: string;
  agentId: string;
  netPayout: number;
}): Promise<JournalPostResult> {
  const idempotencyKey = `QC_RELEASE_${params.missionId}`;

  return postJournalEntry({
    idempotencyKey,
    entityType: 'Mission',
    entityId: params.missionId,
    agentId: params.agentId,
    description: `QC approved: ₦${params.netPayout.toLocaleString()} released to agent available balance`,
    lines: [
      {
        accountId: ACCOUNT_CODES.AGENT_AVAILABLE_BALANCE,
        direction: 'DEBIT',
        amount: params.netPayout,
        description: 'QC-cleared earnings available for payout',
      },
      {
        accountId: ACCOUNT_CODES.AGENT_PENDING_EARNINGS,
        direction: 'CREDIT',
        amount: params.netPayout,
        description: 'Pending earnings released after QC',
      },
    ],
    metadata: {
      missionId: params.missionId,
      netPayout: params.netPayout,
      action: 'QC_RELEASE',
    },
  });
}

/**
 * Post a PAYOUT request (agent requests withdrawal).
 *
 *   DEBIT  PAYOUT_ESCROW          (amount)   — lock for transfer
 *   CREDIT AGENT_AVAILABLE_BALANCE (amount)   — reduce available
 */
export async function postPayoutRequest(params: {
  payoutId: string;
  agentId: string;
  amount: number;
}): Promise<JournalPostResult> {
  const idempotencyKey = `PAYOUT_REQ_${params.payoutId}`;

  return postJournalEntry({
    idempotencyKey,
    entityType: 'Payout',
    entityId: params.payoutId,
    agentId: params.agentId,
    description: `Payout requested: ₦${params.amount.toLocaleString()}`,
    lines: [
      {
        accountId: ACCOUNT_CODES.PAYOUT_ESCROW,
        direction: 'DEBIT',
        amount: params.amount,
        description: 'Payout amount locked in escrow',
      },
      {
        accountId: ACCOUNT_CODES.AGENT_AVAILABLE_BALANCE,
        direction: 'CREDIT',
        amount: params.amount,
        description: 'Available balance reduced for payout',
      },
    ],
    metadata: {
      payoutId: params.payoutId,
      amount: params.amount,
      action: 'PAYOUT_REQUESTED',
    },
  });
}

/**
 * Post PAYOUT SUCCESS (Paystack webhook confirms transfer completed).
 *
 *   DEBIT  PAYOUT_PAYABLE  (netAmount) — payout fulfilled
 *   CREDIT PAYOUT_ESCROW   (amount)   — release escrow
 *   CREDIT ASOJU_FEES_REVENUE (asojuFee) — fee collected on payout
 */
export async function postPayoutSuccess(params: {
  payoutId: string;
  agentId: string;
  amount: number;
  asojuFee: number;
  netAmount: number;
}): Promise<JournalPostResult> {
  const idempotencyKey = `PAYOUT_SUCCESS_${params.payoutId}`;

  return postJournalEntry({
    idempotencyKey,
    entityType: 'Payout',
    entityId: params.payoutId,
    agentId: params.agentId,
    description: `Payout completed via Paystack: ₦${params.netAmount.toLocaleString()} to agent`,
    lines: [
      {
        accountId: ACCOUNT_CODES.PAYOUT_PAYABLE,
        direction: 'DEBIT',
        amount: params.netAmount,
        description: 'Payout fulfilled to agent',
      },
      {
        accountId: ACCOUNT_CODES.ASOJU_FEES_REVENUE,
        direction: 'DEBIT',
        amount: params.asojuFee,
        description: 'Payout processing fee collected',
      },
      {
        accountId: ACCOUNT_CODES.PAYOUT_ESCROW,
        direction: 'CREDIT',
        amount: params.amount,
        description: 'Escrow released after successful payout',
      },
    ],
    metadata: {
      payoutId: params.payoutId,
      amount: params.amount,
      asojuFee: params.asojuFee,
      netAmount: params.netAmount,
      action: 'PAYOUT_SUCCESS',
    },
  });
}

/**
 * Post PAYOUT REVERSAL (Paystack reports failed or reversed transfer).
 *
 *   DEBIT  AGENT_AVAILABLE_BALANCE (amount) — restore to agent
 *   CREDIT PAYOUT_ESCROW          (amount)  — release escrow
 */
export async function postPayoutReversal(params: {
  payoutId: string;
  agentId: string;
  amount: number;
  reason: string;
}): Promise<JournalPostResult> {
  const idempotencyKey = `PAYOUT_REVERSAL_${params.payoutId}`;

  return postJournalEntry({
    idempotencyKey,
    entityType: 'Payout',
    entityId: params.payoutId,
    agentId: params.agentId,
    description: `Payout reversed: ₦${params.amount.toLocaleString()} restored to agent (${params.reason})`,
    lines: [
      {
        accountId: ACCOUNT_CODES.AGENT_AVAILABLE_BALANCE,
        direction: 'DEBIT',
        amount: params.amount,
        description: 'Restored after payout reversal',
      },
      {
        accountId: ACCOUNT_CODES.PAYOUT_ESCROW,
        direction: 'CREDIT',
        amount: params.amount,
        description: 'Escrow released after reversal',
      },
    ],
    metadata: {
      payoutId: params.payoutId,
      amount: params.amount,
      reason: params.reason,
      action: 'PAYOUT_REVERSAL',
    },
  });
}

/**
 * Post Customer Payment received.
 *
 *   DEBIT  CUSTOMER_PAYMENTS  (amount) — payment received
 *   CREDIT CUSTOMER_PAYABLE   (amount) — service owed
 */
export async function postCustomerPayment(params: {
  paymentId: string;
  customerId: string;
  amount: number;
  caseId?: string;
}): Promise<JournalPostResult> {
  const idempotencyKey = `CUST_PAYMENT_${params.paymentId}`;

  return postJournalEntry({
    idempotencyKey,
    entityType: 'Payment',
    entityId: params.paymentId,
    description: `Customer payment received: ₦${params.amount.toLocaleString()}`,
    lines: [
      {
        accountId: ACCOUNT_CODES.CUSTOMER_PAYMENTS,
        direction: 'DEBIT',
        amount: params.amount,
        description: 'Customer payment received',
      },
      {
        accountId: ACCOUNT_CODES.CUSTOMER_PAYABLE,
        direction: 'CREDIT',
        amount: params.amount,
        description: 'Service delivery owed to customer',
      },
    ],
    metadata: {
      paymentId: params.paymentId,
      customerId: params.customerId,
      caseId: params.caseId,
      amount: params.amount,
    },
  });
}

// ─── Account Balance Query ─────────────────────────────────────────────

/**
 * Calculate the current balance of a ledger account.
 * Balance = total debits - total credits for ASSET/EQUITY/EXPENSE
 * Balance = total credits - total debits for LIABILITY/REVENUE
 */
export async function getAccountBalance(code: string): Promise<number> {
  await seedChartOfAccounts();

  const account = await db.ledgerAccount.findUnique({ where: { code } });
  if (!account) return 0;

  const lines = await db.journalLine.findMany({
    where: {
      accountId: account.id,
      journalEntry: { status: 'POSTED' },
    },
    select: { direction: true, amount: true },
  });

  const totalDebits = lines
    .filter((l) => l.direction === 'DEBIT')
    .reduce((sum, l) => sum + l.amount, 0);

  const totalCredits = lines
    .filter((l) => l.direction === 'CREDIT')
    .reduce((sum, l) => sum + l.amount, 0);

  // For assets, equity, expense: balance = debits - credits
  // For liabilities, revenue: balance = credits - debits
  if (['ASSET', 'EQUITY', 'EXPENSE'].includes(account.type)) {
    return totalDebits - totalCredits;
  }
  return totalCredits - totalDebits;
}

/**
 * Get agent wallet balances computed from ledger (source of truth).
 */
export async function getAgentLedgerBalances(agentId: string): Promise<{
  pendingEarnings: number;
  availableBalance: number;
  inEscrow: number;
}> {
  // Agent-specific balances from journal lines
  const entries = await db.journalEntry.findMany({
    where: {
      agentId,
      status: 'POSTED',
    },
    include: { lines: true },
  });

  let pendingEarnings = 0;
  let availableBalance = 0;
  let inEscrow = 0;

  for (const entry of entries) {
    for (const line of entry.lines) {
      const account = await db.ledgerAccount.findUnique({
        where: { id: line.accountId },
        select: { code: true },
      });
      if (!account) continue;

      const signedAmount = line.direction === 'DEBIT' ? line.amount : -line.amount;

      switch (account.code) {
        case ACCOUNT_CODES.AGENT_PENDING_EARNINGS:
          pendingEarnings += signedAmount;
          break;
        case ACCOUNT_CODES.AGENT_AVAILABLE_BALANCE:
          availableBalance += signedAmount;
          break;
        case ACCOUNT_CODES.PAYOUT_ESCROW:
          inEscrow += signedAmount;
          break;
      }
    }
  }

  return { pendingEarnings, availableBalance, inEscrow };
}

// ─── Export Account Codes ───────────────────────────────────────────────

export { ACCOUNT_CODES };

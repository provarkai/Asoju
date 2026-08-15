// ─── /api/admin/finance ────────────────────────────────────────────────
// P0.8: Admin finance dashboard API — ledger, accounts, and summaries
// Requires FINANCE or SUPER_ADMIN role

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAdminAuth, withSecurityHeaders, canAccessFinance } from '@/lib/bola';
import { seedChartOfAccounts, ACCOUNT_CODES } from '@/lib/ledger';

// ─── GET /api/admin/finance ───────────────────────────────────────────
// Finance dashboard summary

export async function GET(request: NextRequest) {
  try {
    const admin = await requireAdminAuth(request, ['SUPER_ADMIN', 'FINANCE', 'OPERATIONS']);
    if (admin instanceof NextResponse) return admin;

    await seedChartOfAccounts();

    // 1. Ledger account balances
    const accounts = await db.ledgerAccount.findMany({
      where: { isActive: true },
      orderBy: { code: 'asc' },
    });

    const accountBalances: { code: string; name: string; type: string; category: string; balance: number }[] = [];

    for (const account of accounts) {
      const lines = await db.journalLine.findMany({
        where: {
          accountId: account.id,
          journalEntry: { status: 'POSTED' },
        },
        select: { direction: true, amount: true },
      });

      const totalDebits = lines.filter((l) => l.direction === 'DEBIT').reduce((sum, l) => sum + l.amount, 0);
      const totalCredits = lines.filter((l) => l.direction === 'CREDIT').reduce((sum, l) => sum + l.amount, 0);

      // Asset/Equity/Expense: balance = debits - credits
      // Liability/Revenue: balance = credits - debits
      const balance = ['ASSET', 'EQUITY', 'EXPENSE'].includes(account.type)
        ? totalDebits - totalCredits
        : totalCredits - totalDebits;

      accountBalances.push({
        code: account.code,
        name: account.name,
        type: account.type,
        category: account.category,
        balance,
      });
    }

    // 2. Payout summary
    const totalPayouts = await db.payout.count();
    const payoutsByStatus = await db.payout.groupBy({
      by: ['status'],
      _count: { id: true },
      _sum: { amount: true, netAmount: true, asojuFee: true },
    });

    const payoutSummary = payoutsByStatus.map((g) => ({
      status: g.status,
      count: g._count.id,
      totalAmount: g._sum.amount || 0,
      totalNetAmount: g._sum.netAmount || 0,
      totalFees: g._sum.asojuFee || 0,
    }));

    // 3. Total journal entries
    const totalJournalEntries = await db.journalEntry.count({ where: { status: 'POSTED' } });
    const totalReversals = await db.journalEntry.count({ where: { status: 'REVERSED' } });

    // 4. Active exceptions
    const activeExceptions = await db.financeException.count({
      where: { resolvedAt: null },
    });
    const criticalExceptions = await db.financeException.count({
      where: { resolvedAt: null, severity: 'CRITICAL' },
    });

    // 5. Agent wallet aggregate
    const walletAggregate = await db.walletAccount.aggregate({
      _sum: {
        pendingBalance: true,
        qcClearedBalance: true,
        availableBalance: true,
        totalEarnings: true,
        totalPaid: true,
      },
      _count: true,
    });

    // 6. Recent journal entries (last 20)
    const recentEntries = await db.journalEntry.findMany({
      where: { status: 'POSTED' },
      include: {
        lines: {
          include: {
            account: { select: { code: true, name: true } },
          },
        },
      },
      orderBy: { postedAt: 'desc' },
      take: 20,
    });

    const response = NextResponse.json({
      accountBalances,
      payoutSummary,
      journalStats: {
        totalPosted: totalJournalEntries,
        totalReversals,
      },
      exceptions: {
        active: activeExceptions,
        critical: criticalExceptions,
      },
      walletAggregate: {
        totalAgents: walletAggregate._count,
        totalPending: walletAggregate._sum.pendingBalance || 0,
        totalQcCleared: walletAggregate._sum.qcClearedBalance || 0,
        totalAvailable: walletAggregate._sum.availableBalance || 0,
        totalEarnings: walletAggregate._sum.totalEarnings || 0,
        totalPaid: walletAggregate._sum.totalPaid || 0,
      },
      recentEntries: recentEntries.map((e) => ({
        id: e.id,
        idempotencyKey: e.idempotencyKey,
        entityType: e.entityType,
        entityId: e.entityId,
        agentId: e.agentId,
        description: e.description,
        postedAt: e.postedAt.toISOString(),
        totalDebits: e.lines.filter((l) => l.direction === 'DEBIT').reduce((sum, l) => sum + l.amount, 0),
        totalCredits: e.lines.filter((l) => l.direction === 'CREDIT').reduce((sum, l) => sum + l.amount, 0),
        lineCount: e.lines.length,
        lines: e.lines.map((l) => ({
          direction: l.direction,
          amount: l.amount,
          accountCode: l.account.code,
          accountName: l.account.name,
        })),
      })),
    });

    return withSecurityHeaders(response);

  } catch (error) {
    console.error('GET /api/admin/finance error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch finance data' },
      { status: 500 }
    );
  }
}

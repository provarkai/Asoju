// ─── /api/admin/finance/ledger ─────────────────────────────────────────
// P0.8: Admin ledger entries API — browse and inspect journal entries
// Requires FINANCE or SUPER_ADMIN role

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAdminAuth, withSecurityHeaders } from '@/lib/bola';
import { seedChartOfAccounts } from '@/lib/ledger';

// ─── GET /api/admin/finance/ledger ────────────────────────────────────
// List journal entries with filters

export async function GET(request: NextRequest) {
  try {
    const admin = await requireAdminAuth(request, ['SUPER_ADMIN', 'FINANCE', 'OPERATIONS']);
    if (admin instanceof NextResponse) return admin;

    await seedChartOfAccounts();

    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get('page') || '1');
    const limit = parseInt(url.searchParams.get('limit') || '20');
    const entityType = url.searchParams.get('entityType');
    const agentId = url.searchParams.get('agentId');
    const status = url.searchParams.get('status') || 'POSTED';

    const skip = (page - 1) * limit;

    const where: any = {};
    if (entityType) where.entityType = entityType;
    if (agentId) where.agentId = agentId;
    if (status) where.status = status;

    const [entries, total] = await Promise.all([
      db.journalEntry.findMany({
        where,
        include: {
          lines: {
            include: {
              account: { select: { code: true, name: true, type: true, category: true } },
            },
            orderBy: { createdAt: 'asc' },
          },
        },
        orderBy: { postedAt: 'desc' },
        skip,
        take: limit,
      }),
      db.journalEntry.count({ where }),
    ]);

    const response = NextResponse.json({
      entries: entries.map((e) => ({
        id: e.id,
        idempotencyKey: e.idempotencyKey,
        entityType: e.entityType,
        entityId: e.entityId,
        agentId: e.agentId,
        description: e.description,
        status: e.status,
        reversalOfId: e.reversalOfId,
        metadata: e.metadata ? JSON.parse(e.metadata) : null,
        postedAt: e.postedAt.toISOString(),
        createdAt: e.createdAt.toISOString(),
        balances: e.lines.reduce(
          (acc, l) => {
            acc.totalDebits += l.direction === 'DEBIT' ? l.amount : 0;
            acc.totalCredits += l.direction === 'CREDIT' ? l.amount : 0;
            return acc;
          },
          { totalDebits: 0, totalCredits: 0 }
        ),
        isBalanced: e.lines.reduce(
          (acc, l) => acc + (l.direction === 'DEBIT' ? l.amount : -l.amount),
          0
        ) === 0,
        lines: e.lines.map((l) => ({
          id: l.id,
          direction: l.direction,
          amount: l.amount,
          description: l.description,
          account: l.account,
        })),
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });

    return withSecurityHeaders(response);

  } catch (error) {
    console.error('GET /api/admin/finance/ledger error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch ledger entries' },
      { status: 500 }
    );
  }
}

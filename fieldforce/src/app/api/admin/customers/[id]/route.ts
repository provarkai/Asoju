import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/admin-auth';

// ─── GET: Customer Detail ──────────────────────────────────────────────

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin(request);
    const { id } = await params;

    const customer = await db.customer.findUnique({
      where: { id },
      include: {
        members: {
          select: {
            id: true,
            email: true,
            displayName: true,
            role: true,
            phone: true,
            isActive: true,
            lastLoginAt: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'asc' },
        },
        cases: {
          select: {
            id: true,
            caseNumber: true,
            title: true,
            serviceCode: true,
            status: true,
            priority: true,
            paymentStatus: true,
            quoteAmount: true,
            createdAt: true,
            completedAt: true,
          },
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
        payments: {
          select: {
            id: true,
            amount: true,
            method: true,
            status: true,
            reference: true,
            paidAt: true,
            createdAt: true,
            case: {
              select: { caseNumber: true, title: true },
            },
          },
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
      },
    });

    if (!customer) {
      return NextResponse.json(
        { error: 'Customer not found' },
        { status: 404 }
      );
    }

    // Aggregate payment summaries
    const paymentSummary = await db.customerPayment.aggregate({
      where: { customerId: id },
      _sum: { amount: true },
      _count: true,
    });

    const verifiedPayments = await db.customerPayment.aggregate({
      where: { customerId: id, status: 'VERIFIED' },
      _sum: { amount: true },
      _count: true,
    });

    const pendingPayments = await db.customerPayment.aggregate({
      where: { customerId: id, status: 'PENDING' },
      _sum: { amount: true },
      _count: true,
    });

    // Case summary
    const caseSummary = await db.case.groupBy({
      by: ['status'],
      where: { customerId: id },
      _count: { id: true },
    });

    return NextResponse.json({
      ...customer,
      members: customer.members.map((m) => ({
        ...m,
        lastLoginAt: m.lastLoginAt?.toISOString() ?? null,
        createdAt: m.createdAt.toISOString(),
      })),
      cases: customer.cases.map((c) => ({
        ...c,
        createdAt: c.createdAt.toISOString(),
        completedAt: c.completedAt?.toISOString() ?? null,
      })),
      payments: customer.payments.map((p) => ({
        ...p,
        paidAt: p.paidAt?.toISOString() ?? null,
        createdAt: p.createdAt.toISOString(),
      })),
      createdAt: customer.createdAt.toISOString(),
      updatedAt: customer.updatedAt.toISOString(),
      summary: {
        totalPayments: paymentSummary._sum.amount || 0,
        totalPaymentCount: paymentSummary._count,
        verifiedTotal: verifiedPayments._sum.amount || 0,
        verifiedCount: verifiedPayments._count,
        pendingTotal: pendingPayments._sum.amount || 0,
        pendingCount: pendingPayments._count,
        casesByStatus: caseSummary.map((s) => ({
          status: s.status,
          count: s._count.id,
        })),
      },
    });
  } catch (error) {
    if (error && typeof error === 'object' && 'status' in error) {
      const err = error as { status: number; message: string };
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('[ADMIN CUSTOMER DETAIL] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// ─── PATCH: Update Customer ─────────────────────────────────────────────

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const admin = await requireAdmin(request);
    const { id } = await params;
    const body = await request.json();

    const customer = await db.customer.findUnique({ where: { id } });
    if (!customer) {
      return NextResponse.json(
        { error: 'Customer not found' },
        { status: 404 }
      );
    }

    // Build update data from allowed fields
    const { name, phone, address, city, state, country, type, status, primaryContact, logoUrl } = body;
    const updateData: Record<string, unknown> = {};

    if (name !== undefined) updateData.name = name.trim();
    if (phone !== undefined) updateData.phone = phone?.trim() || null;
    if (address !== undefined) updateData.address = address?.trim() || null;
    if (city !== undefined) updateData.city = city?.trim() || null;
    if (state !== undefined) updateData.state = state?.trim() || null;
    if (country !== undefined) updateData.country = country?.trim() || 'Nigeria';
    if (type !== undefined) updateData.type = type;
    if (status !== undefined) updateData.status = status;
    if (primaryContact !== undefined) updateData.primaryContact = primaryContact?.trim() || null;
    if (logoUrl !== undefined) updateData.logoUrl = logoUrl || null;

    const updated = await db.customer.update({
      where: { id },
      data: updateData,
    });

    // Audit event
    await db.adminAuditEvent.create({
      data: {
        adminUserId: admin.adminId,
        actorType: 'ADMIN',
        action: 'CUSTOMER_UPDATED',
        entityType: 'Customer',
        entityId: id,
        metadata: JSON.stringify({ changes: Object.keys(updateData) }),
      },
    });

    return NextResponse.json({ customer: updated });
  } catch (error) {
    if (error && typeof error === 'object' && 'status' in error) {
      const err = error as { status: number; message: string };
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('[ADMIN CUSTOMER UPDATE] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

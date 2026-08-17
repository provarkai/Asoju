import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/admin-auth';

// ─── GET: List Customers ────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);

    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20', 10)));
    const search = searchParams.get('search') || '';
    const type = searchParams.get('type') || '';
    const status = searchParams.get('status') || '';

    // Build where clause
    const where: Record<string, unknown> = {};

    if (search) {
      where.OR = [
        { name: { contains: search } },
        { email: { contains: search } },
        { phone: { contains: search } },
      ];
    }
    if (type) {
      where.type = type;
    }
    if (status) {
      where.status = status;
    }

    const [customers, total] = await Promise.all([
      db.customer.findMany({
        where,
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          city: true,
          state: true,
          country: true,
          type: true,
          status: true,
          primaryContact: true,
          logoUrl: true,
          createdAt: true,
          _count: {
            select: {
              members: true,
              cases: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.customer.count({ where }),
    ]);

    // Get total spend per customer
    const customerIds = customers.map((c) => c.id);
    const spendData = customerIds.length > 0
      ? await db.customerPayment.groupBy({
          by: ['customerId'],
          where: {
            customerId: { in: customerIds },
            status: 'VERIFIED',
          },
          _sum: { amount: true },
        })
      : [];

    const spendMap = new Map(
      spendData.map((s) => [s.customerId, s._sum.amount || 0])
    );

    return NextResponse.json({
      customers: customers.map((c) => ({
        ...c,
        memberCount: c._count.members,
        caseCount: c._count.cases,
        totalSpend: spendMap.get(c.id) || 0,
        createdAt: c.createdAt.toISOString(),
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    if (error && typeof error === 'object' && 'status' in error) {
      const err = error as { status: number; message: string };
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('[ADMIN CUSTOMERS] List error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// ─── POST: Create Customer ──────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const admin = await requireAdmin(request);
    const body = await request.json();
    const {
      name, email, phone, address, city, state, country,
      type, primaryContact, logoUrl,
    } = body;

    if (!name || !email) {
      return NextResponse.json(
        { error: 'Name and email are required' },
        { status: 400 }
      );
    }

    // Check for duplicate email
    const existing = await db.customer.findUnique({ where: { email: email.toLowerCase().trim() } });
    if (existing) {
      return NextResponse.json(
        { error: 'A customer with this email already exists' },
        { status: 409 }
      );
    }

    const customer = await db.customer.create({
      data: {
        name: name.trim(),
        email: email.toLowerCase().trim(),
        phone: phone?.trim() || null,
        address: address?.trim() || null,
        city: city?.trim() || null,
        state: state?.trim() || null,
        country: country?.trim() || 'Nigeria',
        type: type || 'INDIVIDUAL',
        primaryContact: primaryContact?.trim() || null,
        logoUrl: logoUrl || null,
      },
    });

    // Audit event
    await db.adminAuditEvent.create({
      data: {
        adminUserId: admin.adminId,
        actorType: 'ADMIN',
        action: 'CUSTOMER_CREATED',
        entityType: 'Customer',
        entityId: customer.id,
        metadata: JSON.stringify({ name: customer.name, email: customer.email }),
      },
    });

    return NextResponse.json({ customer }, { status: 201 });
  } catch (error) {
    if (error && typeof error === 'object' && 'status' in error) {
      const err = error as { status: number; message: string };
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('[ADMIN CUSTOMERS] Create error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

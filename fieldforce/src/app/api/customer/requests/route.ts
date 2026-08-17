// ─── /api/customer/requests ───────────────────────────────────────
// GET: List service requests (filterable by status)
// POST: Create a new service request

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getCustomerAuth } from '@/lib/customer-auth';

export async function GET(request: NextRequest) {
  try {
    const auth = await getCustomerAuth(request);
    if (!auth) {
      return NextResponse.json(
        { error: 'Authentication required', code: 'UNAUTHENTICATED' },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') || '20')));

    const where: Record<string, unknown> = { customerId: auth.customerId };
    if (status) {
      where.status = status;
    }

    const [requests, total] = await Promise.all([
      db.serviceRequest.findMany({
        where,
        include: {
          member: {
            select: { id: true, displayName: true, email: true },
          },
          case: {
            select: { id: true, caseNumber: true, status: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.serviceRequest.count({ where }),
    ]);

    return NextResponse.json({
      data: requests,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('GET /api/customer/requests error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch requests' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await getCustomerAuth(request);
    if (!auth) {
      return NextResponse.json(
        { error: 'Authentication required', code: 'UNAUTHENTICATED' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { serviceCode, title, description, locationAddress, locationLga, locationState, locationLat, locationLng, priority, urgency, specialInstructions } = body;

    if (!serviceCode || !title) {
      return NextResponse.json(
        { error: 'serviceCode and title are required' },
        { status: 400 }
      );
    }

    const serviceRequest = await db.serviceRequest.create({
      data: {
        customerId: auth.customerId,
        memberId: auth.memberId,
        serviceCode,
        title,
        description: description || null,
        locationAddress: locationAddress || null,
        locationLga: locationLga || null,
        locationState: locationState || null,
        locationLat: locationLat ?? null,
        locationLng: locationLng ?? null,
        priority: priority || 'NORMAL',
        urgency: urgency || 'STANDARD',
        specialInstructions: specialInstructions || null,
        status: 'SUBMITTED',
      },
    });

    return NextResponse.json(
      { success: true, data: serviceRequest },
      { status: 201 }
    );
  } catch (error) {
    console.error('POST /api/customer/requests error:', error);
    return NextResponse.json(
      { error: 'Failed to create request' },
      { status: 500 }
    );
  }
}

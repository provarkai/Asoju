// ─── /api/customer/cases/[id]/messages ──────────────────────────────
// GET: Messages for a case (both customer and support messages)
// POST: Send a message as customer

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getCustomerAuth } from '@/lib/customer-auth';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const auth = await getCustomerAuth(request);
    if (!auth) {
      return NextResponse.json(
        { error: 'Authentication required', code: 'UNAUTHENTICATED' },
        { status: 401 }
      );
    }

    const { id } = await context.params;

    // BOLA/IDOR: verify case belongs to this customer
    const caseData = await db.case.findUnique({
      where: { id },
      select: { customerId: true },
    });

    if (!caseData || caseData.customerId !== auth.customerId) {
      return NextResponse.json(
        { error: 'Case not found' },
        { status: 404 }
      );
    }

    const messages = await db.caseMessage.findMany({
      where: { caseId: id },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        senderType: true,
        senderName: true,
        message: true,
        attachmentUrl: true,
        attachmentType: true,
        read: true,
        createdAt: true,
      },
    });

    return NextResponse.json({ data: messages });
  } catch (error) {
    console.error('GET /api/customer/cases/[id]/messages error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch messages' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const auth = await getCustomerAuth(request);
    if (!auth) {
      return NextResponse.json(
        { error: 'Authentication required', code: 'UNAUTHENTICATED' },
        { status: 401 }
      );
    }

    const { id } = await context.params;
    const body = await request.json();
    const { message, attachmentUrl, attachmentType } = body;

    if (!message || typeof message !== 'string' || !message.trim()) {
      return NextResponse.json(
        { error: 'Message is required' },
        { status: 400 }
      );
    }

    // BOLA/IDOR: verify case belongs to this customer
    const caseData = await db.case.findUnique({
      where: { id },
      select: { customerId: true },
    });

    if (!caseData || caseData.customerId !== auth.customerId) {
      return NextResponse.json(
        { error: 'Case not found' },
        { status: 404 }
      );
    }

    // Get member display name
    const member = await db.customerMember.findUnique({
      where: { id: auth.memberId },
      select: { displayName: true },
    });

    const newMessage = await db.caseMessage.create({
      data: {
        caseId: id,
        senderType: 'CUSTOMER',
        senderId: auth.memberId,
        senderName: member?.displayName || 'Customer',
        message: message.trim(),
        attachmentUrl: attachmentUrl || null,
        attachmentType: attachmentType || null,
        read: false,
      },
    });

    return NextResponse.json(
      { success: true, data: newMessage },
      { status: 201 }
    );
  } catch (error) {
    console.error('POST /api/customer/cases/[id]/messages error:', error);
    return NextResponse.json(
      { error: 'Failed to send message' },
      { status: 500 }
    );
  }
}

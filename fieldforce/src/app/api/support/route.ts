import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getAgentIdFromRequest } from '@/lib/auth';

// ─── GET /api/support ────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  try {
    const agentId = getAgentIdFromRequest(request);
    if (!agentId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const missionId = searchParams.get('missionId');

    const messages = await db.supportMessage.findMany({
      where: {
        agentId,
        ...(missionId ? { missionId } : {}),
      },
      orderBy: { createdAt: 'asc' },
    });

    return NextResponse.json(messages);
  } catch (error) {
    console.error('GET /api/support error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch messages' },
      { status: 500 },
    );
  }
}

// ─── POST /api/support ───────────────────────────────────────────────
export async function POST(request: NextRequest) {
  try {
    const agentId = getAgentIdFromRequest(request);
    if (!agentId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const formData = await request.formData();
    const message = formData.get('message') as string;
    const missionId = formData.get('missionId') as string | null;
    const attachment = formData.get('attachment') as File | null;

    if (!message) {
      return NextResponse.json(
        { error: 'Message is required' },
        { status: 400 },
      );
    }

    const msg = await db.supportMessage.create({
      data: {
        agentId,
        sender: 'AGENT',
        message,
        missionId,
        attachmentUrl: attachment ? `uploads/support/${attachment.name}` : null,
        attachmentType: attachment?.type?.startsWith('image')
          ? 'IMAGE'
          : attachment?.type?.startsWith('video')
            ? 'VIDEO'
            : 'DOCUMENT',
      },
    });

    // Auto-generate an ASOJU OPS response for demo
    setTimeout(async () => {
      await db.supportMessage.create({
        data: {
          agentId,
          missionId,
          sender: 'ASOJU_OPS',
          message: getAutoResponse(message),
        },
      });
    }, 3000);

    return NextResponse.json(msg, { status: 201 });
  } catch (error) {
    console.error('POST /api/support error:', error);
    return NextResponse.json(
      { error: 'Failed to send message' },
      { status: 500 },
    );
  }
}

function getAutoResponse(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes('escala') || lower.includes('block') || lower.includes('problem')) {
    return "Thank you for reporting this. We've flagged the issue and an operations team member will review it within 30 minutes. The mission SLA has been paused.";
  }
  if (lower.includes('gps') || lower.includes('location') || lower.includes('check')) {
    return 'GPS check-in issues can occur in areas with poor satellite coverage. Try moving to an open area and ensure Location Services are enabled. If the problem persists, we can do a manual verification.';
  }
  if (lower.includes('payout') || lower.includes('pay') || lower.includes('money') || lower.includes('bank')) {
    return 'Payouts are processed within 48 hours of mission completion and QC approval. If your payout is delayed, please share your bank details so we can verify the routing.';
  }
  return 'Thank you for reaching out. Our operations team is available 8AM-8PM WAT, Monday-Saturday. We typically respond within 15 minutes during business hours. Is there anything specific you need help with?';
}

// ═══════════════════════════════════════════════════════════════════════════════
// Admin Care Plans
// GET  — List care plans or upcoming visits
// POST — Create, activate, pause, cancel, or generate visits
// ═══════════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { db } from '@/lib/db';
import {
  createCarePlan,
  activateCarePlan,
  pauseCarePlan,
  cancelCarePlan,
  generateUpcomingVisits,
  getUpcomingVisits,
  CARE_PLAN_FREQUENCIES,
  CarePlanFrequency,
  CreateCarePlanInput,
} from '@/lib/care-plan-engine';

// ─── GET: List Care Plans or Upcoming Visits ──────────────────────────────

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') || undefined;
    const customerId = searchParams.get('customerId') || undefined;
    const upcoming = searchParams.get('upcoming') === 'true';

    // Upcoming visits across all plans
    if (upcoming) {
      const visits = await getUpcomingVisits(7);
      return NextResponse.json({ visits });
    }

    // Care plans with optional filters
    const where: Record<string, unknown> = {};
    if (status) {
      where.status = status;
    }
    if (customerId) {
      where.customerId = customerId;
    }

    const plans = await db.carePlan.findMany({
      where,
      select: {
        id: true,
        customerId: true,
        beneficiaryName: true,
        beneficiaryPhone: true,
        beneficiaryAddress: true,
        serviceCode: true,
        serviceTitle: true,
        frequency: true,
        preferredDay: true,
        preferredTime: true,
        preferredAgentId: true,
        startDate: true,
        endDate: true,
        maxVisits: true,
        costPerVisit: true,
        status: true,
        totalVisits: true,
        completedVisits: true,
        missedVisits: true,
        nextVisitDate: true,
        totalBilled: true,
        specialInstructions: true,
        createdAt: true,
        customer: {
          select: { id: true, displayName: true, phone: true },
        },
        preferredAgent: {
          select: { id: true, displayName: true, phone: true },
        },
        _count: {
          select: { careVisits: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({
      plans: plans.map((p) => ({
        ...p,
        startDate: p.startDate.toISOString(),
        endDate: p.endDate?.toISOString() ?? null,
        nextVisitDate: p.nextVisitDate?.toISOString() ?? null,
        createdAt: p.createdAt.toISOString(),
        customer: p.customer,
        preferredAgent: p.preferredAgent || null,
      })),
    });
  } catch (error) {
    if (error && typeof error === 'object' && 'status' in error) {
      const err = error as { status: number; message: string };
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('[ADMIN CARE-PLANS] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ─── POST: Care Plan Actions ──────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);

    const body = await request.json();
    const { action } = body;

    if (!action || !['create', 'activate', 'pause', 'cancel', 'generate_visits'].includes(action)) {
      return NextResponse.json(
        { error: 'Action must be create, activate, pause, cancel, or generate_visits' },
        { status: 400 },
      );
    }

    // ── Create Care Plan ────────────────────────────────────────────────────
    if (action === 'create') {
      const {
        customerId,
        beneficiaryName,
        beneficiaryPhone,
        beneficiaryAddress,
        serviceCode,
        serviceTitle,
        frequency,
        preferredDay,
        preferredTime,
        preferredAgentId,
        startDate,
        endDate,
        maxVisits,
        costPerVisit,
        specialInstructions,
      } = body;

      if (!customerId || !beneficiaryName || !beneficiaryPhone || !beneficiaryAddress ||
          !serviceCode || !serviceTitle || !frequency || !startDate || costPerVisit === undefined) {
        return NextResponse.json(
          { error: 'customerId, beneficiaryName, beneficiaryPhone, beneficiaryAddress, serviceCode, serviceTitle, frequency, startDate, and costPerVisit are required' },
          { status: 400 },
        );
      }

      if (!CARE_PLAN_FREQUENCIES[frequency as CarePlanFrequency]) {
        return NextResponse.json(
          { error: `Invalid frequency: ${frequency}. Valid: ${Object.keys(CARE_PLAN_FREQUENCIES).join(', ')}` },
          { status: 400 },
        );
      }

      const input: CreateCarePlanInput = {
        customerId,
        beneficiaryName,
        beneficiaryPhone,
        beneficiaryAddress,
        serviceCode,
        serviceTitle,
        frequency: frequency as CarePlanFrequency,
        preferredDay,
        preferredTime,
        preferredAgentId,
        startDate,
        endDate,
        maxVisits,
        costPerVisit,
        specialInstructions,
      };

      const plan = await createCarePlan(input);
      return NextResponse.json({ message: 'Care plan created', plan }, { status: 201 });
    }

    // ── Activate Care Plan ──────────────────────────────────────────────────
    if (action === 'activate') {
      const { planId } = body;
      if (!planId) {
        return NextResponse.json({ error: 'planId is required' }, { status: 400 });
      }
      const plan = await activateCarePlan(planId);
      return NextResponse.json({ message: 'Care plan activated', plan });
    }

    // ── Pause Care Plan ─────────────────────────────────────────────────────
    if (action === 'pause') {
      const { planId, reason } = body;
      if (!planId) {
        return NextResponse.json({ error: 'planId is required' }, { status: 400 });
      }
      if (!reason) {
        return NextResponse.json({ error: 'reason is required when pausing a plan' }, { status: 400 });
      }
      const plan = await pauseCarePlan(planId, reason);
      return NextResponse.json({ message: 'Care plan paused', plan });
    }

    // ── Cancel Care Plan ────────────────────────────────────────────────────
    if (action === 'cancel') {
      const { planId, reason } = body;
      if (!planId) {
        return NextResponse.json({ error: 'planId is required' }, { status: 400 });
      }
      if (!reason) {
        return NextResponse.json({ error: 'reason is required when cancelling a plan' }, { status: 400 });
      }
      const plan = await cancelCarePlan(planId, reason);
      return NextResponse.json({ message: 'Care plan cancelled', plan });
    }

    // ── Generate Future Visits ──────────────────────────────────────────────
    if (action === 'generate_visits') {
      const { planId, weeks } = body;
      if (!planId) {
        return NextResponse.json({ error: 'planId is required' }, { status: 400 });
      }
      const weeksToGenerate = Math.min(52, Math.max(1, parseInt(weeks || '4', 10)));
      const visits = await generateUpcomingVisits(planId, weeksToGenerate);
      return NextResponse.json({
        message: `${visits.length} visits generated`,
        visits,
      });
    }
  } catch (error) {
    if (error && typeof error === 'object' && 'status' in error) {
      const err = error as { status: number; message: string };
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('[ADMIN CARE-PLANS] POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

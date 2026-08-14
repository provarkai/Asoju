// ═══════════════════════════════════════════════════════════════════════════════
// ASOJU FieldForce — Recurring Care Plans Engine
// ═══════════════════════════════════════════════════════════════════════════════
//
// Manages recurring service schedules for diaspora clients who need
// periodic check-ins on beneficiaries (elderly parents, property, etc.).
//
// CarePlan lifecycle: ACTIVE → PAUSED → ACTIVE (resume) → CANCELLED / EXPIRED
// CareVisit lifecycle:  SCHEDULED → DISPATCHED → IN_PROGRESS → COMPLETED / MISSED / CANCELLED
//
// Each CarePlan generates a set of CareVisit records. On completion,
// the next visit is auto-scheduled based on frequency.
// ═══════════════════════════════════════════════════════════════════════════════

import { db } from '@/lib/db'
import { formatNaira } from '@/lib/constants'

// ─── Constants ──────────────────────────────────────────────────────────────

export const CARE_PLAN_FREQUENCIES = {
  DAILY: {
    label: 'Daily',
    daysBetween: 1,
    description: 'Every day',
  },
  WEEKLY: {
    label: 'Weekly',
    daysBetween: 7,
    description: 'Once per week',
  },
  BIWEEKLY: {
    label: 'Bi-weekly',
    daysBetween: 14,
    description: 'Every two weeks',
  },
  MONTHLY: {
    label: 'Monthly',
    daysBetween: 30,
    description: 'Once per month',
  },
} as const

export type CarePlanFrequency = keyof typeof CARE_PLAN_FREQUENCIES

export const CARE_VISIT_STATUSES = {
  SCHEDULED: { label: 'Scheduled', color: 'bg-blue-100 text-blue-800' },
  DISPATCHED: { label: 'Dispatched', color: 'bg-amber-100 text-amber-800' },
  IN_PROGRESS: { label: 'In Progress', color: 'bg-purple-100 text-purple-800' },
  COMPLETED: { label: 'Completed', color: 'bg-emerald-100 text-emerald-800' },
  MISSED: { label: 'Missed', color: 'bg-red-100 text-red-800' },
  CANCELLED: { label: 'Cancelled', color: 'bg-slate-100 text-slate-600' },
} as const

export type CareVisitStatus = keyof typeof CARE_VISIT_STATUSES

export type CarePlanStatus = 'ACTIVE' | 'PAUSED' | 'CANCELLED' | 'EXPIRED'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CreateCarePlanInput {
  customerId: string
  beneficiaryName: string
  beneficiaryPhone: string
  beneficiaryAddress: string
  serviceCode: string
  serviceTitle: string
  frequency: CarePlanFrequency
  preferredDay?: string
  preferredTime?: string
  preferredAgentId?: string
  startDate: string | Date
  endDate?: string | Date
  maxVisits?: number
  costPerVisit: number
  specialInstructions?: string
}

export interface CompleteCareVisitReport {
  visitNotes?: string
  photoEvidence?: string[]
  gpsLat?: number
  gpsLng?: number
  gpsAccuracy?: number
  beneficiaryStatus?: 'SEEN_AND_OK' | 'SEEN_WITH_CONCERN' | 'NOT_SEEN'
  concernNotes?: string
}

// ─── Day-of-Week Mapping ───────────────────────────────────────────────────

const DAY_NAMES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']

function getDayName(date: Date): string {
  return DAY_NAMES[date.getDay()]
}

// ─── Calculate Next Visit Date ─────────────────────────────────────────────

function calculateNextVisitDate(
  fromDate: Date,
  frequency: CarePlanFrequency,
  preferredDay?: string
): Date {
  const freqConfig = CARE_PLAN_FREQUENCIES[frequency]
  let nextDate = new Date(fromDate)

  // Add frequency interval
  nextDate.setDate(nextDate.getDate() + freqConfig.daysBetween)

  // If a preferred day is specified, adjust to the nearest occurrence of that day
  if (preferredDay && (frequency === 'WEEKLY' || frequency === 'BIWEEKLY')) {
    const targetDayIndex = DAY_NAMES.indexOf(preferredDay.toUpperCase())
    if (targetDayIndex >= 0) {
      const currentDayIndex = nextDate.getDay()
      if (currentDayIndex !== targetDayIndex) {
        let daysToAdd = targetDayIndex - currentDayIndex
        if (daysToAdd <= 0) daysToAdd += 7
        nextDate.setDate(nextDate.getDate() + daysToAdd)
      }
    }
  }

  // Set time to preferred time or default to 09:00 WAT
  if (preferredDay && preferredDay !== undefined) {
    // Time already handled separately in visit creation
  }

  return nextDate
}

// ─── Core: Create a Care Plan ───────────────────────────────────────────────

export async function createCarePlan(input: CreateCarePlanInput) {
  const startDate = new Date(input.startDate)

  // Validate frequency
  if (!CARE_PLAN_FREQUENCIES[input.frequency]) {
    throw new Error(`Invalid frequency: ${input.frequency}`)
  }

  // Create the care plan
  const plan = await db.carePlan.create({
    data: {
      customerId: input.customerId,
      beneficiaryName: input.beneficiaryName,
      beneficiaryPhone: input.beneficiaryPhone,
      beneficiaryAddress: input.beneficiaryAddress,
      serviceCode: input.serviceCode,
      serviceTitle: input.serviceTitle,
      frequency: input.frequency,
      preferredDay: input.preferredDay || null,
      preferredTime: input.preferredTime || null,
      preferredAgentId: input.preferredAgentId || null,
      startDate,
      endDate: input.endDate ? new Date(input.endDate) : null,
      maxVisits: input.maxVisits || null,
      costPerVisit: input.costPerVisit,
      specialInstructions: input.specialInstructions || null,
      status: 'ACTIVE',
    },
  })

  // Generate first set of visits (up to 4 weeks)
  const visits = await generateUpcomingVisits(plan.id, 4)

  // Update plan with total visits generated
  const updatedPlan = await db.carePlan.update({
    where: { id: plan.id },
    data: {
      totalVisits: visits.length,
      nextVisitDate: visits.length > 0 ? visits[0].scheduledDate : null,
    },
  })

  return updatedPlan
}

// ─── Activate Care Plan ────────────────────────────────────────────────────

export async function activateCarePlan(planId: string) {
  const plan = await db.carePlan.findUnique({ where: { id: planId } })
  if (!plan) {
    throw new Error(`Care plan not found: ${planId}`)
  }
  if (plan.status !== 'PAUSED') {
    throw new Error(
      `Cannot activate care plan in status: ${plan.status}. Only PAUSED plans can be activated.`
    )
  }

  return db.carePlan.update({
    where: { id: planId },
    data: { status: 'ACTIVE' },
  })
}

// ─── Pause Care Plan ───────────────────────────────────────────────────────

export async function pauseCarePlan(planId: string, reason: string) {
  const plan = await db.carePlan.findUnique({ where: { id: planId } })
  if (!plan) {
    throw new Error(`Care plan not found: ${planId}`)
  }
  if (plan.status !== 'ACTIVE') {
    throw new Error(
      `Cannot pause care plan in status: ${plan.status}. Only ACTIVE plans can be paused.`
    )
  }

  return db.carePlan.update({
    where: { id: planId },
    data: {
      status: 'PAUSED',
      notes: reason
        ? `[PAUSED] ${new Date().toISOString()}: ${reason}\n${plan.notes || ''}`
        : plan.notes,
    },
  })
}

// ─── Cancel Care Plan ──────────────────────────────────────────────────────

export async function cancelCarePlan(planId: string, reason: string) {
  const plan = await db.carePlan.findUnique({ where: { id: planId } })
  if (!plan) {
    throw new Error(`Care plan not found: ${planId}`)
  }
  if (plan.status === 'CANCELLED' || plan.status === 'EXPIRED') {
    throw new Error(
      `Cannot cancel care plan in status: ${plan.status}`
    )
  }

  // Cancel all future SCHEDULED visits
  await db.careVisit.updateMany({
    where: {
      carePlanId: planId,
      status: 'SCHEDULED',
    },
    data: { status: 'CANCELLED' },
  })

  return db.carePlan.update({
    where: { id: planId },
    data: {
      status: 'CANCELLED',
      notes: reason
        ? `[CANCELLED] ${new Date().toISOString()}: ${reason}\n${plan.notes || ''}`
        : plan.notes,
    },
  })
}

// ─── Generate Upcoming Visits ───────────────────────────────────────────────

export async function generateUpcomingVisits(
  planId: string,
  weeks: number = 4
) {
  const plan = await db.carePlan.findUnique({ where: { id: planId } })
  if (!plan) {
    throw new Error(`Care plan not found: ${planId}`)
  }

  // Find the last visit date (or start from plan start)
  const lastVisit = await db.careVisit.findFirst({
    where: { carePlanId: planId },
    orderBy: { scheduledDate: 'desc' },
  })

  const fromDate = lastVisit
    ? new Date(lastVisit.scheduledDate)
    : new Date(plan.startDate)

  const frequency = plan.frequency as CarePlanFrequency
  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() + weeks * 7)

  // Respect plan end date
  const effectiveCutoff = plan.endDate
    ? new Date(Math.min(cutoffDate.getTime(), new Date(plan.endDate).getTime()))
    : cutoffDate

  const visits = []
  let currentDate = calculateNextVisitDate(fromDate, frequency, plan.preferredDay || undefined)

  // Determine next visit number
  const maxVisitNumber = lastVisit
    ? lastVisit.visitNumber
    : 0

  let visitNumber = maxVisitNumber

  // Respect max visits limit
  const remainingVisits = plan.maxVisits
    ? plan.maxVisits - plan.totalVisits
    : Infinity

  while (currentDate <= effectiveCutoff && visits.length < remainingVisits) {
    visitNumber++

    // Check if this date already has a visit
    const existing = await db.careVisit.findFirst({
      where: {
        carePlanId: planId,
        scheduledDate: currentDate,
      },
    })

    if (!existing) {
      const visit = await db.careVisit.create({
        data: {
          carePlanId: planId,
          scheduledDate: currentDate,
          scheduledTime: plan.preferredTime || '09:00',
          visitNumber,
          status: 'SCHEDULED',
        },
      })
      visits.push(visit)
    }

    currentDate = calculateNextVisitDate(currentDate, frequency, plan.preferredDay || undefined)
  }

  // Update plan's next visit date
  if (visits.length > 0) {
    await db.carePlan.update({
      where: { id: planId },
      data: {
        totalVisits: { increment: visits.length },
        nextVisitDate: visits[0].scheduledDate,
      },
    })
  }

  return visits
}

// ─── Dispatch Care Visit ───────────────────────────────────────────────────

export async function dispatchCareVisit(visitId: string, agentId: string) {
  const visit = await db.careVisit.findUnique({ where: { id: visitId } })
  if (!visit) {
    throw new Error(`Care visit not found: ${visitId}`)
  }
  if (visit.status !== 'SCHEDULED') {
    throw new Error(
      `Cannot dispatch visit in status: ${visit.status}. Only SCHEDULED visits can be dispatched.`
    )
  }

  // Look up agent name
  const agent = await db.agent.findUnique({
    where: { id: agentId },
    select: { displayName: true, firstName: true, lastName: true },
  })
  const agentName = agent
    ? agent.displayName || `${agent.firstName} ${agent.lastName}`.trim()
    : 'Unknown Agent'

  return db.careVisit.update({
    where: { id: visitId },
    data: {
      status: 'DISPATCHED',
      dispatchedAt: new Date(),
      agentId,
      agentName,
    },
  })
}

// ─── Complete Care Visit ───────────────────────────────────────────────────

export async function completeCareVisit(
  visitId: string,
  report: CompleteCareVisitReport
) {
  const visit = await db.careVisit.findUnique({
    where: { id: visitId },
    include: { carePlan: true },
  })
  if (!visit) {
    throw new Error(`Care visit not found: ${visitId}`)
  }
  if (visit.status === 'COMPLETED' || visit.status === 'CANCELLED') {
    throw new Error(
      `Cannot complete visit in status: ${visit.status}`
    )
  }

  const now = new Date()

  // Update the visit
  const completedVisit = await db.careVisit.update({
    where: { id: visitId },
    data: {
      status: 'COMPLETED',
      completedAt: now,
      visitNotes: report.visitNotes || null,
      photoEvidence: report.photoEvidence
        ? JSON.stringify(report.photoEvidence)
        : null,
      gpsLat: report.gpsLat ?? null,
      gpsLng: report.gpsLng ?? null,
      gpsAccuracy: report.gpsAccuracy ?? null,
      beneficiaryStatus: report.beneficiaryStatus || null,
      concernNotes: report.concernNotes || null,
    },
  })

  // Update care plan stats
  const plan = visit.carePlan
  const newCompletedVisits = plan.completedVisits + 1

  // Calculate next visit date
  const nextVisitDate = calculateNextVisitDate(
    now,
    plan.frequency as CarePlanFrequency,
    plan.preferredDay || undefined
  )

  // Check if plan should be marked expired
  let planStatus: string = plan.status
  let planNotes = plan.notes

  if (plan.maxVisits && newCompletedVisits >= plan.maxVisits) {
    planStatus = 'EXPIRED'
    planNotes = `[EXPIRED] ${now.toISOString()}: Max visits (${plan.maxVisits}) reached.\n${plan.notes || ''}`
  } else if (plan.endDate && nextVisitDate > new Date(plan.endDate)) {
    planStatus = 'EXPIRED'
    planNotes = `[EXPIRED] ${now.toISOString()}: Plan end date reached.\n${plan.notes || ''}`
  }

  await db.carePlan.update({
    where: { id: plan.id },
    data: {
      completedVisits: newCompletedVisits,
      nextVisitDate:
        planStatus === 'ACTIVE' ? nextVisitDate : null,
      totalBilled: newCompletedVisits * plan.costPerVisit,
      status: planStatus,
      notes: planNotes,
    },
  })

  // Auto-generate service report for completed care visits
  // (only if visit has a mission linked)
  if (visit.missionId) {
    try {
      const mission = await db.mission.findUnique({
        where: { id: visit.missionId },
        include: {
          agent: {
            select: {
              displayName: true,
              firstName: true,
              lastName: true,
              phone: true,
              tier: { select: { name: true } },
            },
          },
          case: {
            select: {
              id: true,
              customerId: true,
              title: true,
            },
          },
        },
      })

      if (mission) {
        const caseData = mission.case
        if (caseData) {
          await db.serviceReport.upsert({
            where: { missionId: visit.missionId },
            create: {
              missionId: visit.missionId,
              caseId: caseData.id,
              customerId: caseData.customerId,
              agentId: mission.agentId,
              title: `Care Visit Report — ${plan.serviceTitle} #${visit.visitNumber}`,
              outcome: report.beneficiaryStatus === 'NOT_SEEN'
                ? 'FAILED'
                : report.beneficiaryStatus === 'SEEN_WITH_CONCERN'
                  ? 'PARTIALLY_COMPLETED'
                  : 'COMPLETED',
              summary: report.visitNotes || `Care visit #${visit.visitNumber} completed.`,
              photoUrls: report.photoEvidence
                ? JSON.stringify(report.photoEvidence)
                : null,
              gpsLat: report.gpsLat ?? null,
              gpsLng: report.gpsLng ?? null,
              gpsAccuracy: report.gpsAccuracy ?? null,
              completedAt: now,
              submittedAt: now,
              agentName:
                mission.agent?.displayName ||
                `${mission.agent?.firstName || ''} ${mission.agent?.lastName || ''}`.trim(),
              agentPhone: mission.agent?.phone || '',
              agentTier: mission.agent?.tier?.name || null,
            },
            update: {
              outcome: report.beneficiaryStatus === 'NOT_SEEN'
                ? 'FAILED'
                : report.beneficiaryStatus === 'SEEN_WITH_CONCERN'
                  ? 'PARTIALLY_COMPLETED'
                  : 'COMPLETED',
              summary: report.visitNotes || `Care visit #${visit.visitNumber} completed.`,
              photoUrls: report.photoEvidence
                ? JSON.stringify(report.photoEvidence)
                : undefined,
              gpsLat: report.gpsLat ?? undefined,
              gpsLng: report.gpsLng ?? undefined,
              gpsAccuracy: report.gpsAccuracy ?? undefined,
              completedAt: now,
              submittedAt: now,
            },
          })
        }
      }
    } catch {
      // Service report creation is best-effort; don't fail the visit completion
      console.warn(
        `[CarePlan] Could not auto-generate service report for visit ${visitId}`
      )
    }
  }

  // Auto-generate next visit if plan is still active
  if (planStatus === 'ACTIVE') {
    try {
      await scheduleNextVisit(plan.id)
    } catch {
      console.warn(
        `[CarePlan] Could not auto-schedule next visit for plan ${plan.id}`
      )
    }
  }

  return completedVisit
}

// ─── Mark Visit as Missed ──────────────────────────────────────────────────

export async function markVisitMissed(visitId: string) {
  const visit = await db.careVisit.findUnique({
    where: { id: visitId },
    include: { carePlan: true },
  })
  if (!visit) {
    throw new Error(`Care visit not found: ${visitId}`)
  }
  if (visit.status !== 'SCHEDULED' && visit.status !== 'DISPATCHED') {
    throw new Error(
      `Cannot mark visit as missed in status: ${visit.status}`
    )
  }

  const completedVisit = await db.careVisit.update({
    where: { id: visitId },
    data: { status: 'MISSED' },
  })

  // Update plan stats
  await db.carePlan.update({
    where: { id: visit.carePlanId },
    data: { missedVisits: { increment: 1 } },
  })

  // Try to reschedule a replacement visit
  try {
    await scheduleNextVisit(visit.carePlanId)
  } catch {
    console.warn(
      `[CarePlan] Could not reschedule after missed visit ${visitId}`
    )
  }

  return completedVisit
}

// ─── Get Active Care Plans ─────────────────────────────────────────────────

export async function getActiveCarePlans() {
  return db.carePlan.findMany({
    where: { status: 'ACTIVE' },
    orderBy: { nextVisitDate: 'asc' },
    include: {
      customer: {
        select: { id: true, displayName: true, phone: true },
      },
    },
  })
}

// ─── Get Care Plan Visits ──────────────────────────────────────────────────

export async function getCarePlanVisits(planId: string) {
  return db.careVisit.findMany({
    where: { carePlanId: planId },
    orderBy: { scheduledDate: 'asc' },
  })
}

// ─── Get Upcoming Visits (Next N Days) ─────────────────────────────────────

export async function getUpcomingVisits(days: number = 7) {
  const now = new Date()
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() + days)
  cutoff.setHours(23, 59, 59, 999)

  return db.careVisit.findMany({
    where: {
      status: { in: ['SCHEDULED', 'DISPATCHED'] },
      scheduledDate: {
        gte: now,
        lte: cutoff,
      },
    },
    orderBy: { scheduledDate: 'asc' },
    include: {
      carePlan: {
        select: {
          customerId: true,
          beneficiaryName: true,
          beneficiaryPhone: true,
          beneficiaryAddress: true,
          serviceTitle: true,
          specialInstructions: true,
        },
      },
    },
  })
}

// ─── Get Customer Care Plans ───────────────────────────────────────────────

export async function getCustomerCarePlans(customerId: string) {
  return db.carePlan.findMany({
    where: { customerId },
    orderBy: { createdAt: 'desc' },
    include: {
      _count: {
        select: { careVisits: true },
      },
    },
  })
}

// ─── Schedule Next Visit ───────────────────────────────────────────────────

export async function scheduleNextVisit(planId: string) {
  const plan = await db.carePlan.findUnique({ where: { id: planId } })
  if (!plan) {
    throw new Error(`Care plan not found: ${planId}`)
  }
  if (plan.status !== 'ACTIVE') {
    throw new Error(
      `Cannot schedule next visit for plan in status: ${plan.status}`
    )
  }
  if (plan.maxVisits && plan.totalVisits >= plan.maxVisits) {
    throw new Error(
      `Care plan has reached max visits (${plan.maxVisits})`
    )
  }

  // Find the last visit date
  const lastVisit = await db.careVisit.findFirst({
    where: { carePlanId: planId },
    orderBy: { scheduledDate: 'desc' },
  })

  const fromDate = lastVisit
    ? new Date(lastVisit.scheduledDate)
    : new Date(plan.startDate)

  // If plan has end date, check we haven't exceeded it
  if (plan.endDate) {
    const nextDate = calculateNextVisitDate(
      fromDate,
      plan.frequency as CarePlanFrequency,
      plan.preferredDay || undefined
    )
    if (nextDate > new Date(plan.endDate)) {
      // Plan has ended, mark as expired
      await db.carePlan.update({
        where: { id: planId },
        data: {
          status: 'EXPIRED',
          nextVisitDate: null,
          notes: `[EXPIRED] ${new Date().toISOString()}: End date reached.\n${plan.notes || ''}`,
        },
      })
      return null
    }
  }

  const nextDate = calculateNextVisitDate(
    fromDate,
    plan.frequency as CarePlanFrequency,
    plan.preferredDay || undefined
  )

  const nextVisitNumber = (lastVisit?.visitNumber || 0) + 1

  const visit = await db.careVisit.create({
    data: {
      carePlanId: planId,
      scheduledDate: nextDate,
      scheduledTime: plan.preferredTime || '09:00',
      visitNumber: nextVisitNumber,
      status: 'SCHEDULED',
    },
  })

  // Update plan
  await db.carePlan.update({
    where: { id: planId },
    data: {
      totalVisits: { increment: 1 },
      nextVisitDate: nextDate,
    },
  })

  return visit
}

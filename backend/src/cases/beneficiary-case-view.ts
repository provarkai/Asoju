import { DocumentVisibility } from '@prisma/client';

/**
 * "Who is a Beneficiary" (portal access) — what the person a case is
 * named for is allowed to see: status, schedule, evidence, reports. An
 * explicit allowlist projection, not a denylist redaction (same reasoning
 * as pii-restricted-roles.ts/document-visibility.ts, but stricter — this
 * is the first genuinely external, non-staff, non-paying role with case
 * access at all, so the query itself never fetches quotes, invoices,
 * payments, collaborators, risk flags, incidents, approvals, owner/next-
 * action, or audit history for a beneficiary in the first place —
 * defense in depth, not just response-shape filtering).
 */
export const BENEFICIARY_CASE_SELECT = {
  id: true,
  caseNumber: true,
  serviceType: true,
  status: true,
  location: true,
  description: true,
  createdAt: true,
  statusHistory: {
    select: { toStatus: true, createdAt: true },
    orderBy: { createdAt: 'asc' as const },
  },
  assignments: {
    select: {
      role: true,
      status: true,
      scheduledFor: true,
      agent: { select: { fullName: true } },
      provider: { select: { fullName: true } },
    },
  },
  evidence: {
    select: { id: true, type: true, description: true, storageKey: true, createdAt: true },
    orderBy: { createdAt: 'desc' as const },
  },
  // ALL is the default/original visibility (every assignee, plus customer
  // and staff) — STAFF_ONLY and ASSIGNEE-restricted documents stay out of
  // the beneficiary view entirely, a stricter default than what the
  // customer themselves sees (customer sees every document regardless of
  // this field; see Document.visibility's own comment).
  documents: {
    where: { visibility: DocumentVisibility.ALL },
    select: { id: true, label: true, storageKey: true, createdAt: true },
    orderBy: { createdAt: 'desc' as const },
  },
  reports: {
    select: { id: true, summary: true, limitation: true, deliveredAt: true, createdAt: true },
    orderBy: { createdAt: 'desc' as const },
  },
} as const;

interface RawBeneficiaryCase {
  id: string;
  caseNumber: string;
  serviceType: string;
  status: string;
  location: string;
  description: string;
  createdAt: Date;
  statusHistory: { toStatus: string; createdAt: Date }[];
  assignments: {
    role: string;
    status: string;
    scheduledFor: Date | null;
    agent: { fullName: string } | null;
    provider: { fullName: string } | null;
  }[];
  evidence: { id: string; type: string; description: string | null; storageKey: string; createdAt: Date }[];
  documents: { id: string; label: string; storageKey: string; createdAt: Date }[];
  reports: { id: string; summary: string; limitation: string | null; deliveredAt: Date | null; createdAt: Date }[];
}

/** Resolves storageKey -> a short-lived signed viewUrl the same way
 * CasesService.getCaseDetail does for the customer/staff view — never a
 * predictable public URL (Section 11.2). */
export async function toBeneficiaryCaseDetail(
  serviceCase: RawBeneficiaryCase,
  resolveViewUrl: (storageKey: string) => Promise<string>,
) {
  const [evidence, documents] = await Promise.all([
    Promise.all(
      serviceCase.evidence.map(async (item) => ({
        id: item.id,
        type: item.type,
        description: item.description,
        createdAt: item.createdAt,
        viewUrl: await resolveViewUrl(item.storageKey),
      })),
    ),
    Promise.all(
      serviceCase.documents.map(async (doc) => ({
        id: doc.id,
        label: doc.label,
        createdAt: doc.createdAt,
        viewUrl: await resolveViewUrl(doc.storageKey),
      })),
    ),
  ]);

  return {
    id: serviceCase.id,
    caseNumber: serviceCase.caseNumber,
    serviceType: serviceCase.serviceType,
    status: serviceCase.status,
    location: serviceCase.location,
    description: serviceCase.description,
    createdAt: serviceCase.createdAt,
    statusHistory: serviceCase.statusHistory,
    assignments: serviceCase.assignments.map((a) => ({
      role: a.role,
      status: a.status,
      scheduledFor: a.scheduledFor,
      assignee: a.agent?.fullName ?? a.provider?.fullName ?? null,
    })),
    evidence,
    documents,
    reports: serviceCase.reports,
  };
}

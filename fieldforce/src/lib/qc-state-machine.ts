// ═══════════════════════════════════════════════════════════════════════════════
// ASOJU FieldForce — QC/Rework State Machine (P0.7)
// Authoritative QC gate between field execution and mission completion
// ═══════════════════════════════════════════════════════════════════════════════

// ─── QC States ──────────────────────────────────────────────────────────────

export type QcState = 'PENDING' | 'IN_REVIEW' | 'APPROVED' | 'REJECTED';

// ─── QC Actions ─────────────────────────────────────────────────────────────

export type QcAction =
  | 'START_REVIEW'
  | 'APPROVE'
  | 'REJECT'
  | 'REQUEST_REWORK'
  | 'RESUBMIT';

// ─── QC Actor Roles ─────────────────────────────────────────────────────────

export type QcActorRole = 'AGENT' | 'ADMIN' | 'OPERATIONS';

// ─── QC Transition Definition ───────────────────────────────────────────────

export interface QcTransitionDef {
  action: QcAction;
  from: QcState;
  to: QcState;
  allowedRoles: QcActorRole[];
  requiresReason?: boolean;
}

// ─── Valid QC Transitions ───────────────────────────────────────────────────

export const QC_TRANSITIONS: QcTransitionDef[] = [
  { action: 'START_REVIEW',   from: 'PENDING',   to: 'IN_REVIEW',  allowedRoles: ['ADMIN', 'OPERATIONS'] },
  { action: 'APPROVE',        from: 'IN_REVIEW',  to: 'APPROVED',   allowedRoles: ['ADMIN', 'OPERATIONS'] },
  { action: 'REJECT',         from: 'IN_REVIEW',  to: 'REJECTED',   allowedRoles: ['ADMIN', 'OPERATIONS'], requiresReason: true },
  { action: 'REQUEST_REWORK', from: 'IN_REVIEW',  to: 'REJECTED',   allowedRoles: ['ADMIN', 'OPERATIONS'], requiresReason: true },
  { action: 'RESUBMIT',      from: 'REJECTED',   to: 'PENDING',   allowedRoles: ['AGENT'] },
];

// ─── QC State Labels & Colors ────────────────────────────────────────────────

export const QC_STATE_LABELS: Record<QcState, string> = {
  PENDING: 'Pending Review',
  IN_REVIEW: 'Under Review',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
};

export const QC_STATE_COLORS: Record<QcState, string> = {
  PENDING: 'bg-slate-100 text-slate-700 border-slate-200',
  IN_REVIEW: 'bg-orange-100 text-orange-800 border-orange-200',
  APPROVED: 'bg-green-100 text-green-800 border-green-200',
  REJECTED: 'bg-red-100 text-red-800 border-red-200',
};

// ─── Completion Gate ──────────────────────────────────────────────────────────
// All gates must pass before a mission can be marked COMPLETED

export interface CompletionGate {
  qcApproved: boolean;           // QC state === 'APPROVED'
  evidenceValid: boolean;       // P0.5 evidence validity
  gpsCheckinValid: boolean;     // P0.4 GPS check-in passed
  requiredFieldsComplete: boolean; // Checklist 100% complete
  financialReady: boolean;      // P0.8 finance state ready
}

export function evaluateCompletionGate(gate: CompletionGate): {
  passed: boolean;
  failedGates: string[];
} {
  const gateChecks: Array<{ key: keyof CompletionGate; label: string }> = [
    { key: 'qcApproved', label: 'QC Approved' },
    { key: 'evidenceValid', label: 'Evidence Valid' },
    { key: 'gpsCheckinValid', label: 'GPS Check-in Valid' },
    { key: 'requiredFieldsComplete', label: 'Required Fields Complete' },
    { key: 'financialReady', label: 'Financial Ready' },
  ];

  const failedGates = gateChecks
    .filter((g) => !gate[g.key])
    .map((g) => g.label);

  return {
    passed: failedGates.length === 0,
    failedGates,
  };
}

// ─── QC Validation ──────────────────────────────────────────────────────────

export type QcTransitionError =
  | 'QC_NOT_FOUND'
  | 'INVALID_QC_TRANSITION'
  | 'UNAUTHORIZED_QC_TRANSITION'
  | 'MISSING_REVIEW_REASON'
  | 'QC_TRANSITION_ERROR';

export interface QcTransitionResult {
  success: boolean;
  newState?: QcState;
  error?: QcTransitionError;
  message: string;
}

export function validateQcTransition(
  currentState: QcState,
  action: QcAction,
  actorRole: QcActorRole,
  options?: { reason?: string }
): QcTransitionResult {
  const transition = QC_TRANSITIONS.find(
    (t) => t.from === currentState && t.action === action
  );

  if (!transition) {
    return {
      success: false,
      error: 'INVALID_QC_TRANSITION',
      message: `QC action '${action}' is not valid from state '${currentState}'.`,
    };
  }

  if (!transition.allowedRoles.includes(actorRole)) {
    return {
      success: false,
      error: 'UNAUTHORIZED_QC_TRANSITION',
      message: `Role '${actorRole}' is not authorized to perform QC action '${action}'.`,
    };
  }

  if (transition.requiresReason && !options?.reason?.trim()) {
    return {
      success: false,
      error: 'MISSING_REVIEW_REASON',
      message: `QC action '${action}' requires a reason. Please provide details.`,
    };
  }

  return {
    success: true,
    newState: transition.to,
    message: `QC transition '${action}' from '${currentState}' to '${transition.to}' is valid.`,
  };
}

// ─── Get valid QC actions for a state ──────────────────────────────────────

export function getValidQcActions(
  currentState: QcState,
  actorRole?: QcActorRole
): QcAction[] {
  const transitions = QC_TRANSITIONS.filter(
    (t) => t.from === currentState && (!actorRole || t.allowedRoles.includes(actorRole))
  );
  return transitions.map((t) => t.action);
}

// ─── Rejection Reason Categories ────────────────────────────────────────────

export const REJECTION_REASONS = [
  { id: 'missing_evidence', label: 'Missing Evidence', description: 'Required evidence items are missing from the submission' },
  { id: 'insufficient_evidence', label: 'Insufficient Evidence', description: 'Evidence provided does not adequately support the checklist items' },
  { id: 'gps_anomaly', label: 'GPS Check-in Anomaly', description: 'GPS check-in shows suspicious patterns or failed validation' },
  { id: 'incorrect_data', label: 'Incorrect Data Fields', description: 'Data fields contain errors or incorrect information' },
  { id: 'incomplete_checklist', label: 'Incomplete Checklist', description: 'Checklist items were not properly completed' },
  { id: 'photo_quality', label: 'Poor Photo Quality', description: 'Photos are blurry, poorly lit, or do not clearly show the required subject' },
  { id: 'wrong_location', label: 'Wrong Location', description: 'Evidence appears to be from a different location than the mission site' },
  { id: 'safety_concern', label: 'Safety Concern', description: 'Evidence reveals safety or compliance issues that need addressing' },
] as const;

export type RejectionReasonId = typeof REJECTION_REASONS[number]['id'];

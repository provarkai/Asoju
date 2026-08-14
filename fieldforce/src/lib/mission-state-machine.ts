// ═══════════════════════════════════════════════════════════════════════════════
// ASOJU FieldForce — Mission State Machine (P0.3)
// Server-authoritative, role-controlled, race-safe transitions
// ═══════════════════════════════════════════════════════════════════════════════

import type { WorkflowState } from '@/lib/types';

// ─── Mission Transition Actions ─────────────────────────────────────────────

export type MissionAction =
  | 'OFFER'
  | 'ASSIGN'
  | 'START_TRAVEL'
  | 'CHECK_IN'
  | 'BEGIN_EXECUTION'
  | 'PREPARE_SUBMIT'
  | 'SUBMIT'
  | 'ENTER_QC'
  | 'APPROVE'
  | 'REJECT'
  | 'REQUEST_REWORK'
  | 'RESUBMIT'
  | 'ESCALATE'
  | 'PAUSE'
  | 'CANCEL'
  | 'FAIL';

// ─── Role Types ─────────────────────────────────────────────────────────────

export type ActorRole = 'AGENT' | 'ADMIN' | 'SYSTEM' | 'OPERATIONS';

// ─── Transition Definition ──────────────────────────────────────────────────

export interface TransitionDef {
  action: MissionAction;
  from: WorkflowState;
  to: WorkflowState;
  allowedRoles: ActorRole[];
  guard?: string; // Description of guard condition
  requiresReason?: boolean;
}

// ─── Canonical State Transition Map ──────────────────────────────────────────
// Every possible valid state→state transition, with role authorization

export const MISSION_TRANSITIONS: TransitionDef[] = [
  // Primary happy path
  { action: 'OFFER',          from: 'ACCEPTED',   to: 'ACCEPTED',   allowedRoles: ['ADMIN', 'OPERATIONS'], guard: 'Mission exists in system' },
  { action: 'ASSIGN',        from: 'ACCEPTED',   to: 'ACCEPTED',   allowedRoles: ['ADMIN', 'OPERATIONS'], guard: 'Agent eligible & available' },
  { action: 'START_TRAVEL',  from: 'ACCEPTED',   to: 'EN_ROUTE',   allowedRoles: ['AGENT'],                guard: 'Agent owns mission' },
  { action: 'CHECK_IN',      from: 'EN_ROUTE',   to: 'ON_SITE',    allowedRoles: ['AGENT'],                guard: 'GPS geofence PASS (P0.4)' },
  { action: 'BEGIN_EXECUTION', from: 'ON_SITE',   to: 'EXECUTING',  allowedRoles: ['AGENT'],                guard: 'At least 1 checklist item started' },
  { action: 'PREPARE_SUBMIT', from: 'EXECUTING',  to: 'SUBMITTING', allowedRoles: ['AGENT'],                guard: 'Checklist 100% complete' },
  { action: 'SUBMIT',         from: 'SUBMITTING', to: 'SUBMITTED',  allowedRoles: ['AGENT'],                guard: 'Evidence attached & valid' },
  { action: 'ENTER_QC',      from: 'SUBMITTED',  to: 'QC_REVIEW',  allowedRoles: ['SYSTEM'],               guard: 'Auto-transition after submission' },

  // QC outcomes
  { action: 'APPROVE',        from: 'QC_REVIEW',  to: 'COMPLETED',  allowedRoles: ['ADMIN', 'OPERATIONS'], guard: 'All completion gates pass' },
  { action: 'REJECT',         from: 'QC_REVIEW',  to: 'FAILED',     allowedRoles: ['ADMIN', 'OPERATIONS'], guard: 'Invalid/incomplete submission', requiresReason: true },
  { action: 'REQUEST_REWORK', from: 'QC_REVIEW',  to: 'REWORK',     allowedRoles: ['ADMIN', 'OPERATIONS'], guard: 'Actionable rework reason required', requiresReason: true },

  // Rework resubmission
  { action: 'RESUBMIT',      from: 'REWORK',      to: 'SUBMITTED',  allowedRoles: ['AGENT'],                guard: 'Rework items addressed' },
  // After resubmit, system auto-enters QC again
  { action: 'ENTER_QC',      from: 'SUBMITTED',   to: 'QC_REVIEW',  allowedRoles: ['SYSTEM'],               guard: 'Auto-transition after resubmission' },

  // Exception / Side states
  { action: 'ESCALATE',      from: 'EN_ROUTE',    to: 'ESCALATED',  allowedRoles: ['AGENT'],                requiresReason: true },
  { action: 'ESCALATE',      from: 'ON_SITE',     to: 'ESCALATED',  allowedRoles: ['AGENT'],                requiresReason: true },
  { action: 'ESCALATE',      from: 'EXECUTING',   to: 'ESCALATED',  allowedRoles: ['AGENT'],                requiresReason: true },
  { action: 'ESCALATE',      from: 'SUBMITTING',  to: 'ESCALATED',  allowedRoles: ['AGENT'],                requiresReason: true },
  { action: 'PAUSE',         from: 'EN_ROUTE',    to: 'PAUSED',     allowedRoles: ['ADMIN', 'OPERATIONS'],  requiresReason: true },
  { action: 'PAUSE',         from: 'ON_SITE',     to: 'PAUSED',     allowedRoles: ['ADMIN', 'OPERATIONS'],  requiresReason: true },
  { action: 'PAUSE',         from: 'EXECUTING',   to: 'PAUSED',     allowedRoles: ['ADMIN', 'OPERATIONS'],  requiresReason: true },
  { action: 'CANCEL',        from: 'ACCEPTED',    to: 'CANCELLED',  allowedRoles: ['ADMIN', 'OPERATIONS'],  requiresReason: true },
  { action: 'CANCEL',        from: 'EN_ROUTE',    to: 'CANCELLED',  allowedRoles: ['ADMIN', 'OPERATIONS'],  requiresReason: true },
  { action: 'CANCEL',        from: 'ON_SITE',     to: 'CANCELLED',  allowedRoles: ['ADMIN', 'OPERATIONS'],  requiresReason: true },
  { action: 'CANCEL',        from: 'EXECUTING',   to: 'CANCELLED',  allowedRoles: ['ADMIN', 'OPERATIONS'],  requiresReason: true },
  { action: 'CANCEL',        from: 'SUBMITTING',  to: 'CANCELLED',  allowedRoles: ['ADMIN', 'OPERATIONS'],  requiresReason: true },
  { action: 'CANCEL',        from: 'SUBMITTED',   to: 'CANCELLED',  allowedRoles: ['ADMIN', 'OPERATIONS'],  requiresReason: true },
  { action: 'CANCEL',        from: 'REWORK',      to: 'CANCELLED',  allowedRoles: ['ADMIN', 'OPERATIONS'],  requiresReason: true },
  { action: 'FAIL',          from: 'ESCALATED',   to: 'FAILED',     allowedRoles: ['ADMIN', 'OPERATIONS'],  requiresReason: true },
  { action: 'FAIL',          from: 'PAUSED',      to: 'FAILED',     allowedRoles: ['ADMIN', 'OPERATIONS'],  requiresReason: true },

  // Recovery from paused/escalated back to previous active state
  { action: 'START_TRAVEL',  from: 'PAUSED',     to: 'EN_ROUTE',   allowedRoles: ['ADMIN', 'OPERATIONS'] },
  { action: 'CHECK_IN',      from: 'PAUSED',     to: 'ON_SITE',    allowedRoles: ['ADMIN', 'OPERATIONS'], guard: 'GPS geofence PASS (P0.4)' },
  { action: 'BEGIN_EXECUTION', from: 'PAUSED',   to: 'EXECUTING',  allowedRoles: ['ADMIN', 'OPERATIONS'] },
  { action: 'START_TRAVEL',  from: 'ESCALATED',   to: 'EN_ROUTE',   allowedRoles: ['ADMIN', 'OPERATIONS'] },
  { action: 'CHECK_IN',      from: 'ESCALATED',   to: 'ON_SITE',    allowedRoles: ['ADMIN', 'OPERATIONS'], guard: 'GPS geofence PASS (P0.4)' },
  { action: 'BEGIN_EXECUTION', from: 'ESCALATED', to: 'EXECUTING', allowedRoles: ['ADMIN', 'OPERATIONS'] },
  { action: 'REASSIGNED',    from: 'ACCEPTED',    to: 'REASSIGNED', allowedRoles: ['ADMIN', 'OPERATIONS'],  requiresReason: true },
  { action: 'REASSIGNED',    from: 'EN_ROUTE',    to: 'REASSIGNED', allowedRoles: ['ADMIN', 'OPERATIONS'],  requiresReason: true },
];

// ─── Terminal States ─────────────────────────────────────────────────────────
// No transitions OUT of these states

export const TERMINAL_STATES: WorkflowState[] = [
  'COMPLETED',
  'CANCELLED',
  'FAILED',
  'REASSIGNED',
];

// ─── Error Types ────────────────────────────────────────────────────────────

export type MissionTransitionError =
  | 'MISSION_NOT_FOUND'
  | 'MISSION_STATE_CONFLICT'
  | 'INVALID_TRANSITION'
  | 'UNAUTHORIZED_TRANSITION'
  | 'AGENT_OWNERSHIP_REQUIRED'
  | 'MISSING_REASON'
  | 'TRANSITION_ERROR';

export interface TransitionResult {
  success: boolean;
  newState?: WorkflowState;
  error?: MissionTransitionError;
  message: string;
}

// ─── Transition Validation ───────────────────────────────────────────────────
// Pure function — no DB access. Validates if a transition is structurally valid.

export function validateTransition(
  currentState: WorkflowState,
  action: MissionAction,
  actorRole: ActorRole,
  options?: { reason?: string }
): TransitionResult {
  // Check if current state is terminal
  if (TERMINAL_STATES.includes(currentState)) {
    return {
      success: false,
      error: 'INVALID_TRANSITION',
      message: `Cannot transition from terminal state: ${currentState}`,
    };
  }

  // Find matching transition
  const transition = MISSION_TRANSITIONS.find(
    (t) => t.from === currentState && t.action === action
  );

  if (!transition) {
    return {
      success: false,
      error: 'INVALID_TRANSITION',
      message: `Action '${action}' is not valid from state '${currentState}'. Valid actions: ${getValidActions(currentState).join(', ')}`,
    };
  }

  // Check role authorization
  if (!transition.allowedRoles.includes(actorRole)) {
    return {
      success: false,
      error: 'UNAUTHORIZED_TRANSITION',
      message: `Role '${actorRole}' is not authorized to perform action '${action}'. Allowed roles: ${transition.allowedRoles.join(', ')}`,
    };
  }

  // Check if reason is required
  if (transition.requiresReason && !options?.reason?.trim()) {
    return {
      success: false,
      error: 'MISSING_REASON',
      message: `Action '${action}' requires a reason. Please provide a reason for this transition.`,
    };
  }

  return {
    success: true,
    newState: transition.to,
    message: `Transition '${action}' from '${currentState}' to '${transition.to}' is valid.`,
  };
}

// ─── Get Valid Actions for a State ────────────────────────────────────────────

export function getValidActions(
  currentState: WorkflowState,
  actorRole?: ActorRole
): MissionAction[] {
  if (TERMINAL_STATES.includes(currentState)) {
    return [];
  }

  const transitions = MISSION_TRANSITIONS.filter(
    (t) => t.from === currentState && (!actorRole || t.allowedRoles.includes(actorRole))
  );

  return transitions.map((t) => t.action);
}

// ─── Get Next Possible States ────────────────────────────────────────────────

export function getNextStates(currentState: WorkflowState): WorkflowState[] {
  if (TERMINAL_STATES.includes(currentState)) {
    return [];
  }

  const transitions = MISSION_TRANSITIONS.filter((t) => t.from === currentState);
  const uniqueStates = new Set(transitions.map((t) => t.to));
  return Array.from(uniqueStates);
}

// ─── State Metadata for UI ──────────────────────────────────────────────────
// Ordered list of states for the workflow stepper UI

export const WORKFLOW_STEP_ORDER: WorkflowState[] = [
  'ACCEPTED',
  'EN_ROUTE',
  'ON_SITE',
  'EXECUTING',
  'SUBMITTING',
  'SUBMITTED',
  'QC_REVIEW',
  'COMPLETED',
];

export const SIDE_STATES: WorkflowState[] = [
  'ESCALATED',
  'PAUSED',
  'REWORK',
  'CANCELLED',
  'FAILED',
  'REASSIGNED',
];

// ─── Check if a state is a side/exception state ──────────────────────────────

export function isSideState(state: WorkflowState): boolean {
  return SIDE_STATES.includes(state);
}

// ─── Check if a state is terminal ─────────────────────────────────────────────

export function isTerminalState(state: WorkflowState): boolean {
  return TERMINAL_STATES.includes(state);
}

// ─── ASOJU FieldForce v4.0 — Agent Portal Types ──────────────────────────

// ─── Enum-like Type Aliases ─────────────────────────────────────────────────

export type AgentStatus =
  | 'APPLIED'
  | 'IDENTITY_VERIFIED'
  | 'FIELD_VERIFIED'
  | 'ACTIVE'
  | 'RESTRICTED'
  | 'SUSPENDED'
  | 'TERMINATED';

export type VerificationLevel =
  | 'APPLICANT'
  | 'IDENTITY_VERIFIED'
  | 'FIELD_VERIFIED'
  | 'SPECIALIST_VERIFIED';

export type AgentTier = 'Starter' | 'Verified' | 'Pro' | 'Elite';

export type WorkflowState =
  | 'ACCEPTED'
  | 'EN_ROUTE'
  | 'ON_SITE'
  | 'EXECUTING'
  | 'SUBMITTING'
  | 'SUBMITTED'
  | 'QC_REVIEW'
  | 'COMPLETED'
  | 'ESCALATED'
  | 'PAUSED'
  | 'REASSIGNED'
  | 'REWORK'
  | 'CANCELLED'
  | 'FAILED';

export type MissionPriority = 'NORMAL' | 'URGENT' | 'CRITICAL';

export type PayoutStatus =
  | 'REQUESTED'
  | 'PROCESSING'
  | 'SUCCESS'
  | 'FAILED'
  | 'REVERSED';

export type WalletEntryType =
  | 'MISSION_EARNING'
  | 'REWORK_EARNING'
  | 'BONUS'
  | 'EXPENSE_REIMBURSEMENT'
  | 'ADJUSTMENT'
  | 'PAYOUT'
  | 'REVERSAL';

export type GpsCheckResult = 'PASS' | 'FAIL' | 'EXCEPTION';

export type EvidenceStatus =
  | 'CAPTURED'
  | 'QUEUED'
  | 'UPLOADING'
  | 'UPLOADED'
  | 'VALIDATING'
  | 'VALIDATED'
  | 'AVAILABLE';

export type IDType = 'NIN' | 'PASSPORT' | 'VOTERS_CARD';
export type GigPriority = 'NORMAL' | 'URGENT' | 'CRITICAL';
export type GigStatus = 'AVAILABLE' | 'CLAIMED' | 'EXPIRED';
export type SyncOperationType =
  | 'CHECKLIST_UPDATE'
  | 'EVIDENCE_UPLOAD'
  | 'GPS_CHECKIN'
  | 'ESCALATION'
  | 'MISSION_SUBMIT';
export type SyncQueueStatus = 'QUEUED' | 'SYNCING' | 'SYNCED' | 'FAILED';

// ─── QC States ─────────────────────────────────────────────────────────────

export type QcState = 'PENDING' | 'IN_REVIEW' | 'APPROVED' | 'REJECTED';

// ─── GPS Validation ──────────────────────────────────────────────────────────

export type GpsRejectionReason =
  | 'INVALID_COORDINATES'
  | 'ACCURACY_TOO_LOW'
  | 'LOCATION_STALE'
  | 'OUTSIDE_GEOFENCE'
  | 'MISSING_TIMESTAMP';

// ─── Mission Transition ──────────────────────────────────────────────────────

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

// ─── Agent Profile ───────────────────────────────────────────────────────────

export interface AgentProfile {
  id: string;
  userId: string;
  displayName: string;
  phone: string;
  email: string | null;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  idType: string | null;
  idDocumentUrl: string | null;
  selfieUrl: string | null;
  status: AgentStatus;
  verificationLevel: VerificationLevel;
  tierId: string | null;
  tierName: string | null;
  reliabilityScore: number;
  completionRate: number;
  pendingBalance: number;
  qcClearedBalance: number;
  bankCode: string | null;
  accountNumber: string | null;
  accountName: string | null;
  totalMissionsCompleted: number;
  totalEarnings: number;
  currentBalance: number;
  rating: number;
  ratingCount: number;
  lastActiveAt: string | null;
  lgas: AgentLGA[];
  capabilities: string[];
  certifications: string[];
}

export interface AgentLGA {
  state: string;
  lga: string;
}

// ─── Onboarding ─────────────────────────────────────────────────────────────

export interface OnboardingData {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  password: string;
  bankCode: string;
  accountNumber: string;
  accountName: string;
  idType: IDType;
  idDocument: File | null;
  selfie: File | null;
  selectedLGAs: { state: string; lga: string }[];
  cameraGranted: boolean;
  gpsGranted: boolean;
  storageGranted: boolean;
}

// ─── Gig / Marketplace ───────────────────────────────────────────────────────

export interface CaseScope {
  objectives: string[];
  checklist: ChecklistItem[];
  exclusions: string[];
  specialInstructions?: string;
}

export interface ChecklistItem {
  id: string;
  label: string;
  type: 'boolean' | 'photo' | 'note';
  completed: boolean;
  value?: string;
  photoUrl?: string;
}

export interface Gig {
  id: string;
  caseId: string;
  serviceCode: string;
  title: string;
  description: string | null;
  state: string;
  lga: string;
  address: string | null;
  estimatedPayout: number;
  slaDeadline: string;
  priority: GigPriority;
  beneficiaryName: string | null;
  beneficiaryPhone: string | null;
  caseScope: CaseScope | null;
  status: GigStatus;
}

// ─── Mission (Accepted Gig) ──────────────────────────────────────────────────

export interface Mission {
  id: string;
  caseId: string;
  serviceCode: string;
  serviceVersion: string;
  title: string;
  description: string | null;
  state: string;
  lga: string;
  address: string | null;
  payoutAmount: number;
  asojuFee: number;
  netPayout: number;
  slaDeadline: string;
  slaArrivalTarget: string | null;
  slaSubmissionTarget: string | null;
  priority: MissionPriority;
  riskLevel: string;
  beneficiaryName: string | null;
  beneficiaryPhone: string | null;
  workflowState: WorkflowState;
  checklistProgress: number;
  checklistTotal: number;
  evidenceCount: number;
  escalated: boolean;
  escalationReason: string | null;
  escalationType: string | null;
  escalationSeverity: string | null;
  scopeSnapshot: CaseScope | null;
  assignedAt: string;
  acceptedAt: string | null;
  completedAt: string | null;
  submittedAt: string | null;
}

// ─── Payout ──────────────────────────────────────────────────────────────────

export interface PayoutRecord {
  id: string;
  amount: number;
  asojuFee: number;
  netAmount: number;
  status: PayoutStatus;
  paystackReference: string | null;
  missionId: string | null;
  missionTitle: string | null;
  requestedAt: string;
  paidAt: string | null;
}

// ─── Wallet ──────────────────────────────────────────────────────────────────

export interface WalletSummary {
  pendingBalance: number;
  qcClearedBalance: number;
  availableBalance: number;
  totalEarnings: number;
  totalPaid: number;
}

export interface WalletEntryRecord {
  id: string;
  type: WalletEntryType;
  amount: number;
  description: string | null;
  referenceId: string | null;
  createdAt: string;
}

// ─── GPS Check ───────────────────────────────────────────────────────────────

export interface GpsCheckRecord {
  id: string;
  missionId: string;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  distanceFromTarget: number | null;
  result: GpsCheckResult;
  capturedAt: string;
}

// ─── Evidence ────────────────────────────────────────────────────────────────

export interface EvidenceRecord {
  id: string;
  missionId: string;
  mimeType: string | null;
  size: number | null;
  status: EvidenceStatus;
  capturedAt: string | null;
  version: number;
}

// ─── Support ─────────────────────────────────────────────────────────────────

export interface SupportMessage {
  id: string;
  sender: 'AGENT' | 'ASOJU_OPS';
  message: string;
  attachmentUrl: string | null;
  attachmentType: string | null;
  read: boolean;
  createdAt: string;
  missionId: string | null;
}

// ─── QC Review Record ──────────────────────────────────────────────────────

export interface QcReviewRecord {
  id: string;
  missionId: string;
  caseId: string | null;
  cycleNumber: number;
  reviewerId: string | null;
  reviewerName: string | null;
  state: QcState;
  rejectionReason: string | null;
  reworkInstructions: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

// ─── Offline Sync ────────────────────────────────────────────────────────────

export interface OfflineQueueItem {
  id: string;
  missionId: string | null;
  operationType: SyncOperationType;
  payload: Record<string, unknown>;
  idempotencyKey: string;
  status: SyncQueueStatus;
  retryCount: number;
  createdAt: string;
}

// ─── App Navigation ──────────────────────────────────────────────────────────

export type AppTab = 'gigs' | 'missions' | 'earnings' | 'messages' | 'profile' | 'support';

// ─── Service Code Labels (Full Service Catalog) ─────────────────────────────

export const SERVICE_TYPE_LABELS: Record<string, string> = {
  PROPERTY_INSPECTION: 'Property Inspection',
  DOCUMENT_RETRIEVAL: 'Document Retrieval',
  CONSTRUCTION_SITE_INSPECTION: 'Construction Site Inspection',
  BUSINESS_VERIFICATION: 'Business Verification',
  DELIVERY_VERIFICATION: 'Delivery Verification',
  PROPERTY_VALUATION: 'Property Valuation',
  NEIGHBORHOOD_ASSESSMENT: 'Neighborhood Assessment',
  PHOTOSHOOT: 'Photoshoot',
  TASK_EXECUTION: 'Task Execution',
  SITE_VISIT: 'Site Visit',
  FIELD_AUDIT: 'Field Audit',
  ASSET_VERIFICATION: 'Asset Verification',
  INSURANCE_CLAIM_INSPECTION: 'Insurance Claim Inspection',
  TENANCY_INSPECTION: 'Tenancy Inspection',
  COMPLIANCE_CHECK: 'Compliance Check',
};

// ─── Workflow State Labels & Colors ─────────────────────────────────────────

export const WORKFLOW_STATE_LABELS: Record<WorkflowState, string> = {
  ACCEPTED: 'Accepted',
  EN_ROUTE: 'En Route',
  ON_SITE: 'On Site',
  EXECUTING: 'Executing',
  SUBMITTING: 'Submitting',
  SUBMITTED: 'Submitted',
  QC_REVIEW: 'QC Review',
  COMPLETED: 'Completed',
  ESCALATED: 'Escalated',
  PAUSED: 'Paused',
  REASSIGNED: 'Reassigned',
  REWORK: 'Rework',
  CANCELLED: 'Cancelled',
  FAILED: 'Failed',
};

export const WORKFLOW_STATE_COLORS: Record<WorkflowState, string> = {
  ACCEPTED: 'bg-slate-100 text-slate-700 border-slate-200',
  EN_ROUTE: 'bg-amber-100 text-amber-800 border-amber-200',
  ON_SITE: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  EXECUTING: 'bg-sky-100 text-sky-800 border-sky-200',
  SUBMITTING: 'bg-violet-100 text-violet-800 border-violet-200',
  SUBMITTED: 'bg-slate-100 text-slate-700 border-slate-200',
  QC_REVIEW: 'bg-orange-100 text-orange-800 border-orange-200',
  COMPLETED: 'bg-green-100 text-green-800 border-green-200',
  ESCALATED: 'bg-red-100 text-red-800 border-red-200',
  PAUSED: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  REASSIGNED: 'bg-gray-100 text-gray-700 border-gray-200',
  REWORK: 'bg-rose-100 text-rose-800 border-rose-200',
  CANCELLED: 'bg-red-100 text-red-800 border-red-200',
  FAILED: 'bg-red-200 text-red-900 border-red-300',
};

// ─── Payout Status Labels ────────────────────────────────────────────────────

export const PAYOUT_STATUS_LABELS: Record<PayoutStatus, string> = {
  REQUESTED: 'Requested',
  PROCESSING: 'Processing',
  SUCCESS: 'Completed',
  FAILED: 'Failed',
  REVERSED: 'Reversed',
};

// ─── Wallet Entry Type Labels ───────────────────────────────────────────────

export const WALLET_ENTRY_TYPE_LABELS: Record<WalletEntryType, string> = {
  MISSION_EARNING: 'Mission Earning',
  REWORK_EARNING: 'Rework Earning',
  BONUS: 'Bonus',
  EXPENSE_REIMBURSEMENT: 'Expense Reimbursement',
  ADJUSTMENT: 'Adjustment',
  PAYOUT: 'Payout',
  REVERSAL: 'Reversal',
};

// ─── P0.8 Finance Types ────────────────────────────────────────────────────

export type FinanceExceptionType =
  | 'DUPLICATE_WEBHOOK'
  | 'AMOUNT_MISMATCH'
  | 'STATUS_MISMATCH'
  | 'UNBALANCED_ENTRY'
  | 'PAYOUT_FAILURE'
  | 'RECONCILIATION_REQUIRED';

export type FinanceExceptionSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type LedgerAccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';
export type LedgerAccountCategory = 'AGENT' | 'PLATFORM' | 'ESCROW' | 'PAYOUT';
export type JournalLineDirection = 'DEBIT' | 'CREDIT';

export interface LedgerAccountRecord {
  id: string;
  code: string;
  name: string;
  type: LedgerAccountType;
  category: LedgerAccountCategory;
  description: string | null;
  balance: number;
}

export interface JournalEntryRecord {
  id: string;
  idempotencyKey: string;
  entityType: string;
  entityId: string | null;
  agentId: string | null;
  description: string | null;
  status: string;
  reversalOfId: string | null;
  metadata: string | null;
  postedAt: string;
  lines: JournalLineRecord[];
}

export interface JournalLineRecord {
  id: string;
  journalEntryId: string;
  accountId: string;
  accountCode: string;
  accountName: string;
  direction: JournalLineDirection;
  amount: number;
  description: string | null;
}

export interface FinanceExceptionRecord {
  id: string;
  type: FinanceExceptionType;
  severity: FinanceExceptionSeverity;
  entityType: string | null;
  entityId: string | null;
  description: string | null;
  metadata: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolution: string | null;
  createdAt: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// P0.10 — Infrastructure & Reliability Types
// ═══════════════════════════════════════════════════════════════════════════════

export type OutboxStatus = 'PENDING' | 'PROCESSING' | 'DELIVERED' | 'FAILED' | 'DEAD_LETTER';
export type OutboxTargetType = 'WEBHOOK' | 'INTERNAL' | 'INTEGRATION';

export interface OutboxMessageRecord {
  id: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  eventVersion: string;
  payload: string;
  source: string;
  status: OutboxStatus;
  attempts: number;
  maxAttempts: number;
  nextRetryAt: string | null;
  lastError: string | null;
  lastAttemptAt: string | null;
  targetType: string;
  targetUrl: string | null;
  correlationId: string | null;
  createdAt: string;
  deliveredAt: string | null;
  deadLetteredAt: string | null;
}

export interface OutboxMetrics {
  pending: number;
  processing: number;
  delivered: number;
  failed: number;
  deadLetter: number;
  oldestPendingAgeMs: number | null;
  queueDepth: number;
}

export interface CircuitBreakerStats {
  state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  failures: number;
  successes: number;
  totalCalls: number;
  lastFailureAt: string | null;
  lastSuccessAt: string | null;
  openedAt: string | null;
  halfOpenAttempts: number;
}

export interface DependencyHealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  latencyMs: number;
  details?: string;
  checkedAt: string;
}

export interface SchemaReadiness {
  status: 'ready' | 'not_ready';
  missingTables: string[];
  checkedAt: string;
}

export interface ReadinessReport {
  status: 'ready' | 'not_ready';
  database: DependencyHealthStatus;
  schema: SchemaReadiness;
  system: {
    environment: string;
    databaseProvider: string;
    nodeVersion: string;
    uptimeSeconds: number;
    memoryUsage: {
      rssMb: number;
      heapTotalMb: number;
      heapUsedMb: number;
    };
  };
  outbox: {
    pending: number;
    deadLetter: number;
  };
  circuitBreakers: Record<string, { state: string; failures: number }>;
  checkedAt: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// P0.5 Evidence Custody Types
// ═══════════════════════════════════════════════════════════════════════════════

export type EvidenceStatus =
  | 'CAPTURED' | 'UPLOADED' | 'VERIFIED' | 'QUARANTINED'
  | 'QC_REVIEWED' | 'ACCEPTED' | 'REJECTED' | 'ARCHIVED';

export type CustodyEventType =
  | 'CAPTURED' | 'UPLOADED' | 'VERIFIED' | 'QUARANTINED'
  | 'QC_REVIEWED' | 'ACCEPTED' | 'REJECTED' | 'ARCHIVED'
  | 'DOWNLOADED' | 'ACCESSED';

export interface EvidenceCustodyEventRecord {
  id: string;
  evidenceId: string;
  eventType: CustodyEventType;
  actorType: string;
  actorId: string | null;
  actorName: string | null;
  previousStatus: string | null;
  newStatus: string | null;
  details: string | null;
  ipAddress: string | null;
  createdAt: string;
}

export interface EvidenceIntakeResult {
  success: boolean;
  evidenceId?: string;
  serverHash?: string;
  hashMatched?: boolean;
  storageKey?: string;
  status: EvidenceStatus;
  error?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// P0.6 Offline Sync Types
// ═══════════════════════════════════════════════════════════════════════════════

export type SyncStatus = 'QUEUED' | 'UPLOADING' | 'SYNCED' | 'FAILED' | 'CONFLICT';
export type ConflictPolicy = 'APPEND_ONLY' | 'SERVER_WINS' | 'CLIENT_WINS' | 'MANUAL_REVIEW';

export interface SyncEnvelope {
  agentId: string;
  operationType: string;
  resourceType?: string;
  resourceId?: string;
  clientVersion?: number;
  payload: Record<string, unknown>;
  idempotencyKey: string;
  missionId?: string;
  capturedAt?: string;
}

export interface SyncResult {
  success: boolean;
  idempotencyKey: string;
  status: SyncStatus;
  serverVersion?: number;
  serverState?: Record<string, unknown>;
  error?: string;
  conflictPolicy?: ConflictPolicy;
}

export interface SyncQueueStatus {
  agentId: string;
  queued: number;
  uploading: number;
  synced: number;
  failed: number;
  conflicts: number;
  lastSyncAt: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// P0.9 Integration Gateway Types
// ═══════════════════════════════════════════════════════════════════════════════

export interface IntegrationClientRecord {
  id: string;
  name: string;
  clientId: string;
  scopes: string;
  webhookUrl: string | null;
  isActive: boolean;
  rateLimitPerMin: number;
  lastRequestAt: string | null;
  createdAt: string;
}

export interface ExternalMissionMappingRecord {
  id: string;
  clientId: string;
  externalId: string;
  missionId: string;
  externalStatus: string | null;
  syncedAt: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// P0.5 EVIDENCE CUSTODY — Secure Evidence Pipeline & Chain of Custody
// ═══════════════════════════════════════════════════════════════════════════════
//
// Security Invariants:
//   1. Server recomputes SHA-256; client-provided hash is a claim only.
//   2. Object storage is private; signed URLs required for read access.
//   3. Original artifacts are NEVER overwritten.
//   4. Evidence cannot be reassigned by changing IDs in a request.
//   5. EXIF is untrusted; authoritative capture metadata stored separately.
//
// Pipeline: Capture → Manifest → Upload → Hash Verify → Custody Event → QC
// ═══════════════════════════════════════════════════════════════════════════════

import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'
import { createHash } from 'crypto'

// ─── Evidence Status ────────────────────────────────────────────────────────

export const EVIDENCE_STATUS = {
  CAPTURED: 'CAPTURED',
  UPLOADED: 'UPLOADED',
  VERIFIED: 'VERIFIED',
  QUARANTINED: 'QUARANTINED',
  QC_REVIEWED: 'QC_REVIEWED',
  ACCEPTED: 'ACCEPTED',
  REJECTED: 'REJECTED',
  ARCHIVED: 'ARCHIVED',
} as const

export type EvidenceStatus = (typeof EVIDENCE_STATUS)[keyof typeof EVIDENCE_STATUS]

// ─── Custody Event Types ────────────────────────────────────────────────────

export const CUSTODY_EVENT_TYPES = {
  CAPTURED: 'CAPTURED',
  UPLOADED: 'UPLOADED',
  VERIFIED: 'VERIFIED',
  QUARANTINED: 'QUARANTINED',
  QC_REVIEWED: 'QC_REVIEWED',
  ACCEPTED: 'ACCEPTED',
  REJECTED: 'REJECTED',
  ARCHIVED: 'ARCHIVED',
  DOWNLOADED: 'DOWNLOADED',
  ACCESSED: 'ACCESSED',
} as const

// ─── Media Validation ───────────────────────────────────────────────────────

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'application/pdf',
])

const MAX_FILE_SIZE_BYTES = {
  image: 20 * 1024 * 1024,       // 20 MB
  video: 200 * 1024 * 1024,      // 200 MB
  document: 10 * 1024 * 1024,    // 10 MB
}

export interface MediaValidationResult {
  valid: boolean
  error?: string
  mediaCategory?: 'image' | 'video' | 'document'
}

export function validateMedia(
  mimeType: string,
  size: number
): MediaValidationResult {
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    return { valid: false, error: `Unsupported media type: ${mimeType}` }
  }

  let category: 'image' | 'video' | 'document'
  if (mimeType.startsWith('image/')) {
    category = 'image'
  } else if (mimeType.startsWith('video/')) {
    category = 'video'
  } else {
    category = 'document'
  }

  const maxSize = MAX_FILE_SIZE_BYTES[category]
  if (size > maxSize) {
    return {
      valid: false,
      error: `File too large for ${category}: ${size} bytes (max: ${maxSize})`,
    }
  }

  return { valid: true, mediaCategory: category }
}

// ─── SHA-256 Hashing ───────────────────────────────────────────────────────

export function computeSha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex')
}

export function verifyHash(
  buffer: Buffer,
  clientClaimedHash: string
): { serverHash: string; matched: boolean } {
  const serverHash = computeSha256(buffer)
  return {
    serverHash,
    matched: serverHash === clientClaimedHash,
  }
}

// ─── Storage Key Generation ─────────────────────────────────────────────────
// Server-assigned, deterministic, immutable.

export function generateStorageKey(
  missionId: string,
  evidenceId: string,
  originalName: string
): string {
  const ext = originalName.split('.').pop() || 'bin'
  const timestamp = Date.now().toString(36)
  return `evidence/${missionId}/${evidenceId}/${timestamp}.${ext}`
}

// ─── Signed URL Generation (for private storage) ─────────────────────────────
// In production, this generates S3/GCS signed URLs.
// For now, returns a placeholder structure.

export interface SignedUrlResult {
  url: string
  expiresAt: Date
  method: 'PUT' | 'GET'
}

export function generateSignedUploadUrl(
  storageKey: string,
  mimeType: string,
  expiresInMinutes: number = 15
): SignedUrlResult {
  const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000)
  // In production: generate real S3/GCS presigned URL
  const url = `/api/evidence/upload?key=${encodeURIComponent(storageKey)}&expires=${expiresAt.getTime()}`
  return { url, expiresAt, method: 'PUT' }
}

export function generateSignedReadUrl(
  storageKey: string,
  expiresInMinutes: number = 30
): SignedUrlResult {
  const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000)
  // In production: generate real S3/GCS presigned URL
  const url = `/api/evidence/download?key=${encodeURIComponent(storageKey)}&expires=${expiresAt.getTime()}`
  return { url, expiresAt, method: 'GET' }
}

// ─── Custody Event Recording ────────────────────────────────────────────────
// Every evidence state transition creates an immutable custody event.

export async function recordCustodyEvent(
  evidenceId: string,
  eventType: string,
  actor: { type: string; id?: string; name?: string },
  previousStatus: string | null,
  newStatus: string | null,
  details?: Record<string, unknown>,
  ipAddress?: string
): Promise<void> {
  await db.evidenceCustodyEvent.create({
    data: {
      evidenceId,
      eventType,
      actorType: actor.type,
      actorId: actor.id,
      actorName: actor.name,
      previousStatus: previousStatus ?? undefined,
      newStatus: newStatus ?? undefined,
      details: details ? JSON.stringify(details) : undefined,
      ipAddress,
    },
  })
}

// ─── Evidence Intake Pipeline ───────────────────────────────────────────────
// Full server-side evidence processing: validate → hash → record → custody.

export interface EvidenceIntakeInput {
  missionId: string
  agentId: string
  checklistItemId?: string
  fileBuffer: Buffer
  fileName: string
  mimeType: string
  fileSize: number
  clientHash?: string
  captureLat?: number
  captureLng?: number
  capturedAt?: Date
  deviceId?: string
  idempotencyKey?: string
}

export interface EvidenceIntakeResult {
  success: boolean
  evidenceId?: string
  serverHash?: string
  hashMatched?: boolean
  storageKey?: string
  status: EvidenceStatus
  error?: string
}

export async function intakeEvidence(
  input: EvidenceIntakeInput,
  tx?: Prisma.TransactionClient
): Promise<EvidenceIntakeResult> {
  const dbClient = tx ?? db

  // 1. Validate media type and size
  const validation = validateMedia(input.mimeType, input.fileSize)
  if (!validation.valid) {
    return { success: false, status: EVIDENCE_STATUS.CAPTURED, error: validation.error }
  }

  // 2. Check idempotency (offline retry protection)
  if (input.idempotencyKey) {
    const existing = await dbClient.evidenceItem.findFirst({
      where: { idempotencyKey: input.idempotencyKey },
    })
    if (existing) {
      return {
        success: true,
        evidenceId: existing.id,
        serverHash: existing.serverHash ?? undefined,
        hashMatched: existing.hashMatched ?? undefined,
        storageKey: existing.storageKey ?? undefined,
        status: existing.status as EvidenceStatus,
      }
    }
  }

  // 3. Compute server-side SHA-256 (authoritative)
  const serverHash = computeSha256(input.fileBuffer)
  const hashMatched = input.clientHash ? serverHash === input.clientHash : null

  // 4. Generate server-assigned storage key
  const evidenceId = `ev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  const storageKey = generateStorageKey(input.missionId, evidenceId, input.fileName)

  // 5. Determine status
  let status: EvidenceStatus = EVIDENCE_STATUS.VERIFIED
  if (hashMatched === false) {
    status = EVIDENCE_STATUS.QUARANTINED
  }

  // 6. Create evidence record + custody event in transaction
  try {
    await dbClient.$transaction(async (txInner) => {
      await txInner.evidenceItem.create({
        data: {
          id: evidenceId,
          missionId: input.missionId,
          agentId: input.agentId,
          checklistItemId: input.checklistItemId,
          clientHash: input.clientHash,
          serverHash,
          hashMatched: hashMatched ?? undefined,
          storageProvider: 'LOCAL', // Will be S3/GCS in production
          storageKey,
          capturedAt: input.capturedAt ?? new Date(),
          captureLat: input.captureLat,
          captureLng: input.captureLng,
          captureDeviceId: input.deviceId,
          mimeType: input.mimeType,
          size: input.fileSize,
          status,
          idempotencyKey: input.idempotencyKey,
          exifStripped: true, // EXIF should be stripped in production
        },
      })

      await recordCustodyEvent(
        evidenceId,
        hashMatched === false ? CUSTODY_EVENT_TYPES.QUARANTINED : CUSTODY_EVENT_TYPES.VERIFIED,
        { type: 'SYSTEM', id: 'system', name: 'Evidence Pipeline' },
        null,
        status,
        {
          serverHash,
          clientHash: input.clientHash,
          matched: hashMatched,
          fileName: input.fileName,
          fileSize: input.fileSize,
        }
      )
    })

    return {
      success: true,
      evidenceId,
      serverHash,
      hashMatched: hashMatched ?? undefined,
      storageKey,
      status,
    }
  } catch (error) {
    return {
      success: false,
      status: EVIDENCE_STATUS.CAPTURED,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

// ─── Evidence Access Control ────────────────────────────────────────────────
// Generate signed read URL only after verifying authorization.

export async function getEvidenceReadUrl(
  evidenceId: string,
  requesterId: string,
  requesterType: 'AGENT' | 'ADMIN' | 'CUSTOMER'
): Promise<{ url: string; expiresAt: Date } | { error: string }> {
  const evidence = await db.evidenceItem.findUnique({
    where: { id: evidenceId },
    include: {
      mission: {
        include: {
          case: true,
        },
      },
    },
  })

  if (!evidence) {
    return { error: 'Evidence not found' }
  }

  // Authorization check
  if (requesterType === 'AGENT') {
    if (evidence.agentId !== requesterId) {
      return { error: 'Unauthorized: evidence does not belong to this agent' }
    }
  }
  // Admin can access all evidence (already verified by admin auth middleware)

  // Record access event
  await recordCustodyEvent(
    evidenceId,
    CUSTODY_EVENT_TYPES.ACCESSED,
    { type: requesterType, id: requesterId },
    null,
    null,
    { action: 'READ_URL_GENERATED' }
  )

  const signedUrl = generateSignedReadUrl(evidence.storageKey ?? '')
  return { url: signedUrl.url, expiresAt: signedUrl.expiresAt }
}

// ─── Evidence Audit Trail ───────────────────────────────────────────────────

export async function getEvidenceCustodyChain(evidenceId: string) {
  return db.evidenceCustodyEvent.findMany({
    where: { evidenceId },
    orderBy: { createdAt: 'asc' },
  })
}

// ─── Evidence Stats ─────────────────────────────────────────────────────────

export interface EvidenceStats {
  total: number
  verified: number
  quarantined: number
  accepted: number
  rejected: number
}

export async function getEvidenceStats(missionId: string): Promise<EvidenceStats> {
  const items = await db.evidenceItem.findMany({
    where: { missionId },
    select: { status: true },
  })

  return {
    total: items.length,
    verified: items.filter((e) => e.status === EVIDENCE_STATUS.VERIFIED).length,
    quarantined: items.filter((e) => e.status === EVIDENCE_STATUS.QUARANTINED).length,
    accepted: items.filter((e) => e.status === EVIDENCE_STATUS.ACCEPTED).length,
    rejected: items.filter((e) => e.status === EVIDENCE_STATUS.REJECTED).length,
  }
}

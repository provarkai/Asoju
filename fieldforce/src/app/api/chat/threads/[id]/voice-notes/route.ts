// ═══════════════════════════════════════════════════════════════════════════════
// MOAT BUILDER — Voice Notes in Chat
// POST /api/chat/threads/[id]/voice-notes
// ═══════════════════════════════════════════════════════════════════════════════
// Accepts a recorded voice note, runs it through transcribeAndTranslate
// (voice-translation.ts), and persists the result as a VoiceNote row. Same
// "any portal token" auth pattern as the sibling chat routes in this
// directory (messages/route.ts, [id]/route.ts) — duplicated rather than
// factored out, matching how each of those routes already duplicates it.
//
// Thread membership is authorized by asking the chat-service itself
// (GET /api/threads/:id, same call [id]/route.ts's GET makes) rather than
// re-implementing participant checks here — chat-service is the source of
// truth for thread membership; VoiceNote only ever references it by id.

import { NextRequest, NextResponse } from 'next/server'
import { submitVoiceNote } from '@/lib/voice-notes'
import type { SupportedSourceLanguage } from '@/lib/voice-translation'
import { SUPPORTED_SOURCE_LANGUAGES } from '@/lib/voice-translation'

interface ChatUser {
  userId: string
  role: string
  displayName: string
}

async function extractUser(request: NextRequest): Promise<ChatUser | null> {
  const authHeader = request.headers.get('authorization')
  let token: string | null = null

  if (authHeader?.startsWith('Bearer ')) {
    token = authHeader.slice(7)
  } else {
    const cookieHeader = request.headers.get('cookie') || ''
    const adminMatch = cookieHeader.match(/admin_token=([^;]+)/)
    if (adminMatch) token = adminMatch[1]
    if (!token) {
      const custMatch = cookieHeader.match(/cust_token=([^;]+)/)
      if (custMatch) token = custMatch[1]
    }
    if (!token) {
      const agentMatch = cookieHeader.match(/asoju-agent-token=([^;]+)/)
      if (agentMatch) token = agentMatch[1]
    }
  }

  if (!token) return null

  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'))
    const issuer = payload.iss

    if (issuer === 'asoju-admin') {
      return { userId: payload.adminId || payload.userId, role: 'ADMIN', displayName: payload.email || payload.displayName || 'Admin' }
    }
    if (issuer === 'asoju-customer') {
      return { userId: payload.memberId || payload.userId, role: 'CUSTOMER', displayName: payload.email || payload.displayName || 'Customer' }
    }
    if (issuer === 'asoju-agent' || issuer === 'asoju-fieldforce') {
      return { userId: payload.agentId || payload.userId, role: 'AGENT', displayName: payload.phone || payload.displayName || 'Agent' }
    }
    if (payload.userId && payload.role) {
      return { userId: payload.userId, role: payload.role, displayName: payload.displayName || 'User' }
    }
  } catch {
    return null
  }

  return null
}

async function verifyThreadMembership(threadId: string, user: ChatUser): Promise<boolean> {
  try {
    const res = await fetch(`http://localhost:3005/api/threads/${threadId}`, {
      method: 'GET',
      headers: {
        'X-User-Id': user.userId,
        'X-User-Role': user.role,
        'X-User-Name': user.displayName,
      },
    })
    return res.ok
  } catch {
    // chat-service unreachable — fail closed, same as any other
    // authorization dependency being down.
    return false
  }
}

function isSupportedLanguageHint(value: unknown): value is SupportedSourceLanguage {
  return typeof value === 'string' && (SUPPORTED_SOURCE_LANGUAGES as readonly string[]).includes(value)
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await extractUser(request)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id: threadId } = await params

  const isParticipant = await verifyThreadMembership(threadId, user)
  if (!isParticipant) {
    return NextResponse.json({ error: 'Not authorised for this thread' }, { status: 403 })
  }

  const formData = await request.formData()
  const messageId = formData.get('messageId') as string | null
  const file = formData.get('file') as File | null
  const durationSecondsRaw = formData.get('durationSeconds') as string | null
  const languageHintRaw = formData.get('languageHint') as string | null

  if (!messageId || !file || !durationSecondsRaw) {
    return NextResponse.json({ error: 'messageId, file, and durationSeconds are required' }, { status: 400 })
  }

  const durationSeconds = parseFloat(durationSecondsRaw)
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return NextResponse.json({ error: 'durationSeconds must be a positive number' }, { status: 400 })
  }

  const languageHint = isSupportedLanguageHint(languageHintRaw) ? languageHintRaw : undefined

  const audioBuffer = Buffer.from(await file.arrayBuffer())

  const result = await submitVoiceNote({
    messageId,
    threadId,
    senderId: user.userId,
    senderRole: user.role,
    audioBuffer,
    fileName: file.name,
    mimeType: file.type,
    durationSeconds,
    languageHint,
  })

  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }

  return NextResponse.json({ success: true, voiceNote: result.voiceNote })
}

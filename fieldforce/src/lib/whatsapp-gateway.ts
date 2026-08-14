// ═══════════════════════════════════════════════════════════════════════════════
// ASOJU FieldForce — WhatsApp Notification Gateway
// ═══════════════════════════════════════════════════════════════════════════════
//
// Notification gateway for WhatsApp Business API integration.
// Messages are queued in the database and processed by a background worker.
// In demo mode (no WhatsApp credentials), messages are marked DELIVERED with a log.
//
// Status lifecycle: PENDING → QUEUED → SENT → DELIVERED → READ
// Failure path:      PENDING → QUEUED → FAILED (with retries → FAILED)
// ═══════════════════════════════════════════════════════════════════════════════

import { db } from '@/lib/db'
import { formatNaira } from '@/lib/constants'

// ─── Configuration ──────────────────────────────────────────────────────────

const WHATSAPP_API_URL = process.env.WHATSAPP_API_URL || ''
const WHATSAPP_ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN || ''
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || ''
const WHATSAPP_DEMO_MODE = !WHATSAPP_ACCESS_TOKEN
const MAX_RETRIES_DEFAULT = 3
const RETRY_BACKOFF_BASE_MS = 5_000 // 5 seconds base, exponential
const RETRY_BACKOFF_MAX_MS = 15 * 60 * 1000 // 15 minutes max
const PROCESSING_BATCH_SIZE = 20

// ─── Types ──────────────────────────────────────────────────────────────────

export type WhatsAppNotificationStatus =
  | 'PENDING'
  | 'QUEUED'
  | 'SENT'
  | 'DELIVERED'
  | 'READ'
  | 'FAILED'

export type WhatsAppMediaType = 'IMAGE' | 'DOCUMENT' | 'VIDEO' | 'AUDIO'

export type NotificationEntityType =
  | 'MISSION'
  | 'CASE'
  | 'CARE_VISIT'
  | 'SOS'
  | 'REPORT'
  | 'CARE_PLAN'

export type RecipientRole = 'CUSTOMER' | 'BENEFICIARY' | 'ADMIN' | 'AGENT'

export interface SendWhatsAppMessageInput {
  recipientPhone: string
  recipientName?: string
  recipientRole: RecipientRole
  templateId?: string
  templateParams?: string[]
  messageText?: string
  mediaUrl?: string
  mediaType?: WhatsAppMediaType
  entityType?: NotificationEntityType
  entityId?: string
  caseId?: string
}

export interface NotificationStats {
  total: number
  pending: number
  queued: number
  sent: number
  delivered: number
  read: number
  failed: number
}

export interface ProcessResult {
  processed: number
  delivered: number
  failed: number
  skipped: number
}

// ─── WhatsApp Template Definitions ──────────────────────────────────────────

export interface WhatsAppTemplate {
  id: string
  name: string
  category: string
  body: string
  parameters: string[]
  hasMedia: boolean
  mediaType?: WhatsAppMediaType
}

export const WHATSAPP_TEMPLATES: Record<string, WhatsAppTemplate> = {
  SERVICE_COMPLETE: {
    id: 'service_complete',
    name: 'Service Complete Notification',
    category: 'UTILITY',
    body: 'Your service {{service_title}} has been completed. Agent: {{agent_name}}. Photos available in your portal.',
    parameters: ['service_title', 'agent_name'],
    hasMedia: false,
  },
  CARE_VISIT_REPORT: {
    id: 'care_visit_report',
    name: 'Care Visit Report',
    category: 'UTILITY',
    body: 'Care visit #{{visit_number}} completed for {{beneficiary_name}}. Status: {{status}}.',
    parameters: ['visit_number', 'beneficiary_name', 'status'],
    hasMedia: false,
  },
  SOS_ALERT: {
    id: 'sos_alert',
    name: 'SOS Emergency Alert',
    category: 'AUTHENTICATION',
    body: '⚠️ Emergency alert from agent {{agent_name}}. Type: {{alert_type}}. Please respond immediately.',
    parameters: ['agent_name', 'alert_type'],
    hasMedia: false,
  },
  MISSION_ASSIGNED: {
    id: 'mission_assigned',
    name: 'Mission Assigned',
    category: 'UTILITY',
    body: 'A field agent has been assigned to your service request {{case_title}}.',
    parameters: ['case_title'],
    hasMedia: false,
  },
  MISSION_ARRIVED: {
    id: 'mission_arrived',
    name: 'Mission Arrived',
    category: 'UTILITY',
    body: 'Your field agent has arrived at the service location.',
    parameters: [],
    hasMedia: false,
  },
}

// ─── Core: Queue a WhatsApp Notification ────────────────────────────────────

export async function sendWhatsAppMessage(
  input: SendWhatsAppMessageInput
) {
  const notification = await db.whatsAppNotification.create({
    data: {
      recipientPhone: input.recipientPhone,
      recipientName: input.recipientName || null,
      recipientRole: input.recipientRole,
      templateId: input.templateId || null,
      templateParams: input.templateParams
        ? JSON.stringify(input.templateParams)
        : null,
      messageText: input.messageText || null,
      mediaUrl: input.mediaUrl || null,
      mediaType: input.mediaType || null,
      entityType: input.entityType || null,
      entityId: input.entityId || null,
      caseId: input.caseId || null,
      status: 'PENDING',
      maxRetries: MAX_RETRIES_DEFAULT,
    },
  })

  return notification
}

// ─── Process Pending Notifications (Worker/Cron) ────────────────────────────

export async function processPendingNotifications(
  limit: number = PROCESSING_BATCH_SIZE
): Promise<ProcessResult> {
  const now = new Date()
  const result: ProcessResult = {
    processed: 0,
    delivered: 0,
    failed: 0,
    skipped: 0,
  }

  // Claim notifications that are PENDING or ready for retry
  const notifications = await db.whatsAppNotification.findMany({
    where: {
      status: { in: ['PENDING', 'QUEUED'] },
      OR: [
        { nextRetryAt: null },
        { nextRetryAt: { lte: now } },
      ],
      retryCount: { lt: MAX_RETRIES_DEFAULT },
    },
    orderBy: { createdAt: 'asc' },
    take: limit,
  })

  for (const notification of notifications) {
    result.processed++

    try {
      // Mark as queued before processing
      await db.whatsAppNotification.update({
        where: { id: notification.id },
        data: { status: 'QUEUED' },
      })

      // Attempt delivery
      if (WHATSAPP_DEMO_MODE) {
        // Demo mode: simulate successful delivery
        const recipientLabel = notification.recipientName
          ? `${notification.recipientName} (${notification.recipientPhone})`
          : notification.recipientPhone

        console.log(
          `[WhatsApp Demo] Would send to ${recipientLabel}: ${
            notification.messageText ||
            `[Template: ${notification.templateId}, Params: ${notification.templateParams}]`
          }${
            notification.mediaUrl
              ? ` [Media: ${notification.mediaType} - ${notification.mediaUrl}]`
              : ''
          }`
        )

        // Simulate a brief delay to mimic API call
        await new Promise((resolve) => setTimeout(resolve, 50))

        await db.whatsAppNotification.update({
          where: { id: notification.id },
          data: {
            status: 'DELIVERED',
            sentAt: now,
            deliveredAt: new Date(now.getTime() + 1000),
            whatsappMessageId: `demo_${notification.id}_${Date.now()}`,
          },
        })

        result.delivered++
      } else {
        // Production mode: send via WhatsApp Business API
        const deliveryResult = await deliverToWhatsAppApi(notification)

        if (deliveryResult.success) {
          await db.whatsAppNotification.update({
            where: { id: notification.id },
            data: {
              status: deliveryResult.status,
              sentAt: now,
              deliveredAt:
                deliveryResult.status === 'DELIVERED' ? new Date(now.getTime() + 1000) : null,
              whatsappMessageId: deliveryResult.messageId,
            },
          })
          result.delivered++
        } else {
          await handleDeliveryFailure(notification, deliveryResult.error!)
          result.failed++
        }
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown processing error'
      await handleDeliveryFailure(notification, errorMessage)
      result.failed++
    }
  }

  return result
}

// ─── WhatsApp API Delivery (Production) ─────────────────────────────────────

interface WhatsAppDeliveryResult {
  success: boolean
  status?: WhatsAppNotificationStatus
  messageId?: string
  error?: string
}

async function deliverToWhatsAppApi(
  notification: Awaited<
    ReturnType<typeof db.whatsAppNotification.findFirst>
  >
): Promise<WhatsAppDeliveryResult> {
  if (!notification) {
    return { success: false, error: 'Notification not found' }
  }

  // Normalize: the notification from Prisma has the right shape
  const notif = notification as NonNullable<typeof notification>

  try {
    const payload = buildWhatsAppPayload(notif)

    const response = await fetch(
      `${WHATSAPP_API_URL}/${WHATSAPP_PHONE_NUMBER_ID}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      }
    )

    if (!response.ok) {
      const errorBody = await response.text()
      return {
        success: false,
        error: `WhatsApp API ${response.status}: ${errorBody}`,
      }
    }

    const data = await response.json()
    const messageId = data?.messages?.[0]?.id

    if (!messageId) {
      return { success: false, error: 'No message ID in WhatsApp response' }
    }

    return {
      success: true,
      status: 'SENT',
      messageId,
    }
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Network error'
    return { success: false, error: errorMessage }
  }
}

function buildWhatsAppPayload(notif: {
  recipientPhone: string
  templateId: string | null
  templateParams: string | null
  messageText: string | null
  mediaUrl: string | null
  mediaType: string | null
}) {
  // Template message
  if (notif.templateId) {
    const params = notif.templateParams
      ? JSON.parse(notif.templateParams)
      : []

    return {
      messaging_product: 'whatsapp',
      to: notif.recipientPhone,
      type: 'template',
      template: {
        name: notif.templateId,
        language: { code: 'en' },
        components: [
          {
            type: 'body',
            parameters: params.map((p: string) => ({ type: 'text', text: p })),
          },
        ],
      },
    }
  }

  // Media message
  if (notif.mediaUrl && notif.mediaType) {
    return {
      messaging_product: 'whatsapp',
      to: notif.recipientPhone,
      type: notif.mediaType.toLowerCase(),
      [notif.mediaType.toLowerCase()]: {
        link: notif.mediaUrl,
        caption: notif.messageText || undefined,
      },
    }
  }

  // Plain text message
  return {
    messaging_product: 'whatsapp',
    to: notif.recipientPhone,
    type: 'text',
    text: {
      body: notif.messageText || '',
      preview_url: false,
    },
  }
}

// ─── Retry / Failure Handling ───────────────────────────────────────────────

async function handleDeliveryFailure(
  notification: { id: string; retryCount: number; maxRetries: number },
  error: string
) {
  const newRetryCount = notification.retryCount + 1
  const isExhausted = newRetryCount >= notification.maxRetries

  // Exponential backoff: 5s, 10s, 20s, ..., max 15 minutes
  const backoffMs = Math.min(
    RETRY_BACKOFF_BASE_MS * Math.pow(2, notification.retryCount),
    RETRY_BACKOFF_MAX_MS
  )
  const nextRetryAt = isExhausted
    ? null
    : new Date(Date.now() + backoffMs)

  await db.whatsAppNotification.update({
    where: { id: notification.id },
    data: {
      status: isExhausted ? 'FAILED' : 'PENDING',
      retryCount: newRetryCount,
      nextRetryAt,
      errorCode: isExhausted ? 'MAX_RETRIES_EXCEEDED' : 'RETRY_SCHEDULED',
      errorMessage: error,
      failedAt: isExhausted ? new Date() : null,
    },
  })
}

// ─── Convenience: Send Service Complete Notification ────────────────────────

export async function sendServiceCompleteNotification(caseId: string) {
  const mission = await db.mission.findFirst({
    where: { caseId },
    include: {
      agent: { select: { displayName: true, firstName: true, lastName: true } },
      case: {
        select: {
          customerId: true,
          title: true,
          serviceCode: true,
          customer: {
            select: { phone: true, displayName: true }
          }
        },
      },
    },
  })

  if (!mission) {
    throw new Error(`Mission not found for case ${caseId}`)
  }

  const customer = mission.case.customer
  if (!customer?.phone) {
    throw new Error(`Customer phone not found for case ${caseId}`)
  }

  const agentName =
    mission.agent?.displayName ||
    `${mission.agent?.firstName || ''} ${mission.agent?.lastName || ''}`.trim() ||
    'Agent'
  const serviceTitle = mission.case.title || mission.serviceCode

  const template = WHATSAPP_TEMPLATES.SERVICE_COMPLETE
  const messageText = template.body
    .replace('{{service_title}}', serviceTitle)
    .replace('{{agent_name}}', agentName)

  return sendWhatsAppMessage({
    recipientPhone: customer.phone,
    recipientName: customer.displayName || undefined,
    recipientRole: 'CUSTOMER',
    templateId: template.id,
    templateParams: [serviceTitle, agentName],
    messageText,
    entityType: 'CASE',
    entityId: caseId,
    caseId,
  })
}

// ─── Convenience: Send Care Visit Report ────────────────────────────────────

export async function sendCareVisitReport(careVisitId: string) {
  const visit = await db.careVisit.findUnique({
    where: { id: careVisitId },
    include: {
      carePlan: {
        select: {
          customerId: true,
          beneficiaryName: true,
          serviceTitle: true,
          reportChannel: true,
          customer: {
            select: { phone: true, displayName: true }
          },
        },
      },
    },
  })

  if (!visit) {
    throw new Error(`Care visit not found: ${careVisitId}`)
  }

  const plan = visit.carePlan
  if (!plan.customer?.phone) {
    throw new Error(`Customer phone not found for care plan ${plan.customerId}`)
  }

  const statusLabel = visit.beneficiaryStatus || visit.status

  const template = WHATSAPP_TEMPLATES.CARE_VISIT_REPORT
  const messageText = template.body
    .replace('{{visit_number}}', String(visit.visitNumber))
    .replace('{{beneficiary_name}}', plan.beneficiaryName)
    .replace('{{status}}', statusLabel)

  const notification = await sendWhatsAppMessage({
    recipientPhone: plan.customer.phone,
    recipientName: plan.customer.displayName || undefined,
    recipientRole: 'CUSTOMER',
    templateId: template.id,
    templateParams: [
      String(visit.visitNumber),
      plan.beneficiaryName,
      statusLabel,
    ],
    messageText,
    entityType: 'CARE_VISIT',
    entityId: careVisitId,
  })

  // Mark report as sent on the visit
  await db.careVisit.update({
    where: { id: careVisitId },
    data: {
      reportSentAt: new Date(),
      reportChannel: plan.reportChannel,
      reportId: notification.id,
    },
  })

  return notification
}

// ─── Convenience: Send SOS Escalation Notification ──────────────────────────

export async function sendSosEscalationNotification(sosAlertId: string) {
  const alert = await db.sosAlert.findUnique({
    where: { id: sosAlertId },
    include: {
      agent: { select: { displayName: true, firstName: true, lastName: true } },
    },
  })

  if (!alert) {
    throw new Error(`SOS alert not found: ${sosAlertId}`)
  }

  const agentName =
    alert.agent?.displayName ||
    `${alert.agent?.firstName || ''} ${alert.agent?.lastName || ''}`.trim() ||
    'Unknown Agent'

  const template = WHATSAPP_TEMPLATES.SOS_ALERT
  const messageText = template.body
    .replace('{{agent_name}}', agentName)
    .replace('{{alert_type}}', alert.alertType)

  // Send to all admin users
  const admins = await db.adminUser.findMany({
    where: { phone: { not: null } },
    select: { id: true, phone: true, displayName: true },
  })

  const notifications = []

  for (const admin of admins) {
    if (!admin.phone) continue

    const notif = await sendWhatsAppMessage({
      recipientPhone: admin.phone,
      recipientName: admin.displayName || undefined,
      recipientRole: 'ADMIN',
      templateId: template.id,
      templateParams: [agentName, alert.alertType],
      messageText,
      entityType: 'SOS',
      entityId: sosAlertId,
      caseId: alert.caseId || undefined,
    })
    notifications.push(notif)
  }

  // If there's a case with a customer, notify them too
  if (alert.caseId) {
    const caseData = await db.case.findUnique({
      where: { id: alert.caseId },
      select: {
        customerId: true,
        customer: { select: { phone: true, displayName: true } },
      },
    })

    if (caseData?.customer?.phone) {
      const customerNotif = await sendWhatsAppMessage({
        recipientPhone: caseData.customer.phone,
        recipientName: caseData.customer.displayName || undefined,
        recipientRole: 'CUSTOMER',
        templateId: template.id,
        templateParams: [agentName, alert.alertType],
        messageText,
        entityType: 'SOS',
        entityId: sosAlertId,
        caseId: alert.caseId,
      })
      notifications.push(customerNotif)
    }
  }

  return notifications
}

// ─── Get Notification Stats ─────────────────────────────────────────────────

export async function getNotificationStats(): Promise<NotificationStats> {
  const [total, pending, queued, sent, delivered, read, failed] =
    await Promise.all([
      db.whatsAppNotification.count(),
      db.whatsAppNotification.count({ where: { status: 'PENDING' } }),
      db.whatsAppNotification.count({ where: { status: 'QUEUED' } }),
      db.whatsAppNotification.count({ where: { status: 'SENT' } }),
      db.whatsAppNotification.count({ where: { status: 'DELIVERED' } }),
      db.whatsAppNotification.count({ where: { status: 'READ' } }),
      db.whatsAppNotification.count({ where: { status: 'FAILED' } }),
    ])

  return { total, pending, queued, sent, delivered, read, failed }
}

// ─── Get Notifications by Entity ────────────────────────────────────────────

export async function getNotificationsByEntity(
  entityType: NotificationEntityType,
  entityId: string
) {
  return db.whatsAppNotification.findMany({
    where: { entityType, entityId },
    orderBy: { createdAt: 'desc' },
  })
}

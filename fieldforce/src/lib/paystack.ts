// ─── ASOJU FieldForce — P0.8 Paystack Integration Library ───────────────
// Webhook signature verification, payout initiation, and reconciliation
//
// Security rules:
// - Clients never hold provider secret credentials
// - Webhook signature verification before business processing
// - Duplicate webhooks are idempotent
// - Provider transfer status reconciles to internal payout status

import crypto from 'crypto';

// ─── Paystack Configuration ─────────────────────────────────────────────

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY || '';
const PAYSTACK_BASE_URL = 'https://api.paystack.co';

/**
 * Check if Paystack is configured for production use.
 * Returns false in demo/prototype mode.
 */
export function isPaystackConfigured(): boolean {
  return !!PAYSTACK_SECRET_KEY && PAYSTACK_SECRET_KEY !== '';
}

// ─── Webhook Signature Verification ──────────────────────────────────────

/**
 * Verify Paystack webhook signature using HMAC-SHA512.
 * CRITICAL: This MUST be called BEFORE any business processing.
 *
 * @param rawBody - The raw request body as a string (important: must be raw, not parsed)
 * @param signature - The value of the `x-paystack-signature` header
 * @returns true if signature is valid, false otherwise
 */
export function verifyPaystackSignature(
  rawBody: string,
  signature: string
): boolean {
  if (!PAYSTACK_SECRET_KEY) {
    // In demo mode, accept all webhooks (no real Paystack)
    return true;
  }

  if (!signature || !rawBody) {
    return false;
  }

  const hmac = crypto.createHmac('sha512', PAYSTACK_SECRET_KEY);
  hmac.update(rawBody);
  const expectedSignature = hmac.digest('hex');

  // Constant-time comparison to prevent timing attacks
  return crypto.timingSafeEqual(
    Buffer.from(expectedSignature),
    Buffer.from(signature)
  );
}

// ─── Paystack API Helpers ──────────────────────────────────────────────

/**
 * Generate a provider reference for Paystack transfers.
 * Format: ASOJU_PAYOUT_<payoutId>_<timestamp>
 * This is used as the idempotent transfer_reference when initiating a transfer.
 */
export function generateProviderReference(payoutId: string): string {
  return `ASOJU_PAYOUT_${payoutId}_${Date.now()}`;
}

/**
 * Generate an idempotency key for payout requests.
 * Format: PAYOUT_REQ_<agentId>_<timestamp>_<random>
 */
export function generatePayoutIdempotencyKey(agentId: string): string {
  const random = crypto.randomBytes(4).toString('hex');
  return `PAYOUT_REQ_${agentId}_${Date.now()}_${random}`;
}

/**
 * Initiate a Paystack transfer (production only).
 * In demo mode, this returns a mock successful response.
 *
 * @param params - Transfer parameters
 * @returns Paystack transfer response
 */
export async function initiatePaystackTransfer(params: {
  amount: number;       // in kobo (minor units)
  recipient: string;    // Paystack transfer recipient code
  reference: string;    // Provider reference (idempotent)
  reason?: string;
}): Promise<{ success: boolean; reference?: string; status?: string; error?: string }> {
  if (!isPaystackConfigured()) {
    // Demo mode: simulate successful transfer
    return {
      success: true,
      reference: params.reference,
      status: 'pending',
    };
  }

  try {
    const response = await fetch(`${PAYSTACK_BASE_URL}/transfer`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        source: 'balance',
        amount: params.amount,
        recipient: params.recipient,
        reference: params.reference,
        reason: params.reason || 'ASOJU FieldForce Payout',
      }),
    });

    const data = await response.json();

    if (data.status && data.data) {
      return {
        success: true,
        reference: data.data.reference,
        status: data.data.status,
      };
    }

    return {
      success: false,
      error: data.message || 'Transfer initiation failed',
    };
  } catch (error) {
    return {
      success: false,
      error: `Paystack API error: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

/**
 * Verify a Paystack transaction (for customer payments).
 *
 * @param reference - Paystack payment reference
 * @returns Verification result
 */
export async function verifyPaystackTransaction(reference: string): Promise<{
  success: boolean;
  amount?: number;  // in kobo
  status?: string;
  error?: string;
}> {
  if (!isPaystackConfigured()) {
    return { success: true, amount: 0, status: 'success' };
  }

  try {
    const response = await fetch(
      `${PAYSTACK_BASE_URL}/transaction/verify/${reference}`,
      {
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
        },
      }
    );

    const data = await response.json();

    if (data.status && data.data?.status === 'success') {
      return {
        success: true,
        amount: data.data.amount,
        status: data.data.status,
      };
    }

    return {
      success: false,
      amount: data.data?.amount,
      status: data.data?.status,
      error: data.message || 'Verification failed',
    };
  } catch (error) {
    return {
      success: false,
      error: `Paystack API error: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

// ─── Webhook Event Types ───────────────────────────────────────────────

export interface PaystackWebhookEvent {
  event: string;
  data: {
    id: number;
    reference: string;
    amount: number;
    status: string;
    recipient?: {
      recipient_code: string;
      details?: {
        account_number: string;
        bank_code: string;
        bank_name: string;
        account_name: string;
      };
    };
    source?: {
      type: string;
      currency: string;
    };
    failures?: number;
    domain: string;
    timestamp: number;
    fees?: number;
    paid_at?: string;
    created_at?: string;
    updated_at?: string;
  };
}

/**
 * Parse and classify a Paystack webhook event.
 * Returns the event type and provider reference for reconciliation.
 */
export function parseWebhookEvent(payload: PaystackWebhookEvent): {
  eventType: 'TRANSFER_SUCCESS' | 'TRANSFER_FAILED' | 'TRANSFER_REVERSED' | 'UNKNOWN';
  providerReference: string | null;
  amount: number;
  status: string;
} {
  const event = payload.event;
  const data = payload.data;

  let eventType: PaystackWebhookEvent['eventType'] = 'UNKNOWN';
  if (event === 'transfer.success') eventType = 'TRANSFER_SUCCESS';
  else if (event === 'transfer.failed') eventType = 'TRANSFER_FAILED';
  else if (event === 'transfer.reversed') eventType = 'TRANSFER_REVERSED';

  return {
    eventType,
    providerReference: data?.reference || null,
    amount: data?.amount || 0,
    status: data?.status || 'unknown',
  };
}

// ─── Paystack Transfer Status Mapping ──────────────────────────────────

/**
 * Map Paystack transfer status to internal payout status.
 */
export function mapPaystackStatusToPayout(paystackStatus: string): {
  payoutStatus: string;
  isTerminal: boolean;
} {
  switch (paystackStatus) {
    case 'success':
    case 'completed':
      return { payoutStatus: 'SUCCESS', isTerminal: true };
    case 'pending':
    case 'processing':
      return { payoutStatus: 'PROCESSING', isTerminal: false };
    case 'failed':
    case 'expired':
      return { payoutStatus: 'FAILED', isTerminal: true };
    case 'reversed':
      return { payoutStatus: 'REVERSED', isTerminal: true };
    case 'cancelled':
      return { payoutStatus: 'FAILED', isTerminal: true };
    default:
      return { payoutStatus: 'PROCESSING', isTerminal: false };
  }
}

// ─── Paystack Fee Calculation ────────────────────────────────────────────

/**
 * Calculate Paystack transfer fees.
 * Standard: 1.5% capped at ₦2,000 for amounts > ₦10,000.
 */
export function calculatePaystackFee(amountKobo: number): number {
  const threshold = 1000000; // ₦10,000 in kobo
  if (amountKobo <= threshold) {
    return Math.ceil(amountKobo * 0.015);
  }
  return 200000; // ₦2,000 in kobo
}

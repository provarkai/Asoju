// ─── POST /api/webhooks/paystack ────────────────────────────────────────
// P0.8: Paystack webhook handler with signature verification, deduplication,
// reconciliation, and double-entry ledger updates.
//
// Security flow:
// 1. Verify Paystack HMAC-SHA512 signature (before ANY business processing)
// 2. Deduplicate webhook by provider reference
// 3. Reconcile amount, currency, status
// 4. Update payout/ledger state
// 5. Record audit event

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { verifyPaystackSignature, parseWebhookEvent, mapPaystackStatusToPayout } from '@/lib/paystack';
import { postPayoutSuccess, postPayoutReversal, seedChartOfAccounts } from '@/lib/ledger';

// ─── POST Handler ──────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    // Step 1: Verify signature (CRITICAL — before any business logic)
    const signature = request.headers.get('x-paystack-signature') || '';
    const rawBody = await request.text();
    const payload = JSON.parse(rawBody);

    if (!verifyPaystackSignature(rawBody, signature)) {
      console.error('[PAYSTACK WEBHOOK] Invalid signature');
      return NextResponse.json(
        { error: 'Invalid signature' },
        { status: 401 }
      );
    }

    // Step 2: Parse event
    const event = parseWebhookEvent(payload);
    console.log(`[PAYSTACK WEBHOOK] Event: ${event.eventType}, Reference: ${event.providerReference}`);

    if (event.eventType === 'UNKNOWN') {
      console.log(`[PAYSTACK WEBHOOK] Ignoring unknown event: ${payload.event}`);
      return NextResponse.json({ received: true, processed: false });
    }

    // Step 3: Find payout by provider reference
    if (!event.providerReference) {
      console.error('[PAYSTACK WEBHOOK] No provider reference in event');
      return NextResponse.json({ received: true, processed: false });
    }

    const payout = await db.payout.findFirst({
      where: { providerReference: event.providerReference },
    });

    if (!payout) {
      console.error(`[PAYSTACK WEBHOOK] No payout found for reference: ${event.providerReference}`);
      // Record exception for investigation
      await db.financeException.create({
        data: {
          type: 'RECONCILIATION_REQUIRED',
          severity: 'MEDIUM',
          entityType: 'Payout',
          entityId: event.providerReference,
          description: `Webhook received for unknown provider reference: ${event.providerReference}`,
          metadata: JSON.stringify({ event: payload.event, data: payload.data, rawBody }),
        },
      });
      return NextResponse.json({ received: true, processed: false });
    }

    // Step 4: Deduplication check
    if (payout.webhookReceivedAt) {
      console.log(`[PAYSTACK WEBHOOK] Duplicate webhook for payout ${payout.id}, already processed`);
      // Create exception for tracking
      await db.financeException.create({
        data: {
          type: 'DUPLICATE_WEBHOOK',
          severity: 'LOW',
          entityType: 'Payout',
          entityId: payout.id,
          description: `Duplicate webhook received for payout ${payout.id}`,
          metadata: JSON.stringify({ event: payload.event, providerReference: event.providerReference }),
        },
      });
      return NextResponse.json({ received: true, processed: true, idempotent: true });
    }

    // Step 5: Reconcile amount
    if (event.amount > 0 && event.amount !== payout.amount) {
      console.error(`[PAYSTACK WEBHOOK] Amount mismatch: webhook=${event.amount}, payout=${payout.amount}`);
      await db.financeException.create({
        data: {
          type: 'AMOUNT_MISMATCH',
          severity: 'HIGH',
          entityType: 'Payout',
          entityId: payout.id,
          description: `Amount mismatch: webhook amount=${event.amount}, payout amount=${payout.amount}`,
          metadata: JSON.stringify({ webhookAmount: event.amount, payoutAmount: payout.amount, providerReference: event.providerReference }),
        },
      });
    }

    // Step 6: Process event
    const { payoutStatus, isTerminal } = mapPaystackStatusToPayout(event.status);

    if (event.eventType === 'TRANSFER_SUCCESS') {
      // Mark payout as SUCCESS
      await db.payout.update({
        where: { id: payout.id },
        data: {
          status: payoutStatus,
          paystackReference: payload.data.reference?.toString() || payout.paystackReference,
          paystackStatus: event.status,
          webhookReceivedAt: new Date(),
          paidAt: payout.paidAt || new Date(),
          reconciledAt: new Date(),
          reconciliationNote: 'Reconciled via Paystack webhook',
        },
      });

      // Post double-entry ledger: Payout success
      await seedChartOfAccounts();
      const ledgerResult = await postPayoutSuccess({
        payoutId: payout.id,
        agentId: payout.agentId,
        amount: payout.amount,
        asojuFee: payout.asojuFee,
        netAmount: payout.netAmount,
      });

      if (!ledgerResult.success) {
        console.error(`[PAYSTACK WEBHOOK] Ledger posting failed: ${ledgerResult.error}`);
        await db.financeException.create({
          data: {
            type: 'UNBALANCED_ENTRY',
            severity: 'CRITICAL',
            entityType: 'Payout',
            entityId: payout.id,
            description: `Ledger posting failed on payout success: ${ledgerResult.error}`,
            metadata: JSON.stringify({ ledgerResult }),
          },
        });
      }

      // Link journal entry to payout
      if (ledgerResult.journalEntryId) {
        await db.payout.update({
          where: { id: payout.id },
          data: { journalEntryId: ledgerResult.journalEntryId },
        });
      }

      // Update wallet account (read model)
      const wallet = await db.walletAccount.findUnique({ where: { agentId: payout.agentId } });
      if (wallet) {
        await db.walletAccount.update({
          where: { id: wallet.id },
          data: {
            totalPaid: { increment: payout.netAmount },
          },
        });
      }

    } else if (event.eventType === 'TRANSFER_FAILED') {
      await db.payout.update({
        where: { id: payout.id },
        data: {
          status: 'FAILED',
          paystackReference: payload.data.reference?.toString() || payout.paystackReference,
          paystackStatus: event.status,
          failureReason: payload.data?.failures ? `Transfer failed after ${payload.data.failures} attempts` : 'Transfer failed',
          failureCode: 'TRANSFER_FAILED',
          webhookReceivedAt: new Date(),
          failedAt: new Date(),
        },
      });

      // Post double-entry ledger: Payout reversal (restore funds to agent)
      await seedChartOfAccounts();
      const reversalResult = await postPayoutReversal({
        payoutId: payout.id,
        agentId: payout.agentId,
        amount: payout.amount,
        reason: `Paystack transfer failed: ${event.status}`,
      });

      if (reversalResult.success) {
        // Restore wallet available balance
        const wallet = await db.walletAccount.findUnique({ where: { agentId: payout.agentId } });
        if (wallet) {
          await db.walletAccount.update({
            where: { id: wallet.id },
            data: {
              availableBalance: { increment: payout.amount },
            },
          });
        }
      }

      // Record exception
      await db.financeException.create({
        data: {
          type: 'PAYOUT_FAILURE',
          severity: 'HIGH',
          entityType: 'Payout',
          entityId: payout.id,
          description: `Paystack transfer failed for payout ${payout.id}`,
          metadata: JSON.stringify({ payload: payload.data, reversalResult }),
        },
      });

    } else if (event.eventType === 'TRANSFER_REVERSED') {
      await db.payout.update({
        where: { id: payout.id },
        data: {
          status: 'REVERSED',
          paystackReference: payload.data.reference?.toString() || payout.paystackReference,
          paystackStatus: event.status,
          webhookReceivedAt: new Date(),
          reversedAt: new Date(),
          failureReason: 'Transfer reversed by provider',
        },
      });

      // Restore agent funds
      await seedChartOfAccounts();
      await postPayoutReversal({
        payoutId: payout.id,
        agentId: payout.agentId,
        amount: payout.amount,
        reason: 'Paystack transfer reversed',
      });

      const wallet = await db.walletAccount.findUnique({ where: { agentId: payout.agentId } });
      if (wallet) {
        await db.walletAccount.update({
          where: { id: wallet.id },
          data: {
            availableBalance: { increment: payout.amount },
            totalPaid: { decrement: payout.netAmount },
          },
        });
      }
    }

    // Step 7: Audit event
    await db.adminAuditEvent.create({
      data: {
        actorType: 'SYSTEM',
        action: `PAYSTACK_WEBHOOK_${event.eventType}`,
        entityType: 'Payout',
        entityId: payout.id,
        metadata: JSON.stringify({
          eventType: event.eventType,
          providerReference: event.providerReference,
          paystackStatus: event.status,
          internalStatus: payoutStatus,
          amount: event.amount,
        }),
      },
    });

    return NextResponse.json({ received: true, processed: true });

  } catch (error) {
    console.error('[PAYSTACK WEBHOOK] Error:', error);
    return NextResponse.json(
      { error: 'Webhook processing failed' },
      { status: 500 }
    );
  }
}

// ─── GET Handler (for Paystack verification) ────────────────────────────

export async function GET() {
  // Paystack sends a GET to verify webhook endpoint during setup
  return NextResponse.json({ status: 'active' });
}

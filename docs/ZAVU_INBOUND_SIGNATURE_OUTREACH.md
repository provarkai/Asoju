# Ask Zavu: inbound webhook signature scheme

**Why:** `backend/src/whatsapp/whatsapp-webhook.guard.ts` currently accepts inbound
WhatsApp messages with a shared-secret header (`X-Webhook-Secret` = `WHATSAPP_WEBHOOK_SECRET`)
instead of verifying Zavu's real signature. That's a stand-in, not the real
thing — the same gap `PaystackWebhookGuard`'s HMAC-SHA512 closed for payments.
Confirmed from Zavu's public docs (docs.zavu.dev): inbound webhooks carry an
`X-Zavu-Signature` header and a per-sender secret shaped like `whsec_...`
(returned once from `POST /v1/senders/:id/webhook/secret`). **Not confirmed:**
the exact signing algorithm or canonical string to sign — their docs point to
"the Security guide" for this without exposing it to an unauthenticated fetch.

Only way to close this: ask Zavu directly. Send the message below to their
support (or whoever issued the `zv_test_...` sandbox key already used during
development).

---

**Subject:** Inbound webhook signature verification scheme for `X-Zavu-Signature`

Hi Zavu team,

We're integrating Zavu for WhatsApp messaging (outbound is live and working
against your sandbox API). We're now implementing signature verification for
inbound webhooks and need the exact scheme for `X-Zavu-Signature` so we can
verify it server-side rather than trusting an unauthenticated request.

Specifically:

1. **Algorithm** — HMAC-SHA256? SHA512? Something else?
2. **Signed payload** — is it the raw request body, or a canonical string
   (e.g. `timestamp.body`, method+path+body, etc.)?
3. **Header format** — is `X-Zavu-Signature` the raw hex/base64 digest, or
   does it include a prefix/version (e.g. Stripe-style `t=...,v1=...`)?
4. **Secret source** — confirming this is the `whsec_...` secret returned
   from `POST /v1/senders/:id/webhook/secret`, used as the HMAC key?
5. **Replay protection** — is there a timestamp header we should also
   validate, and an acceptable clock-skew window?
6. A worked example (sample payload + secret + expected signature) would let
   us verify our implementation byte-for-byte before deploying it, the same
   way we verified our Paystack HMAC-SHA512 integration against a
   hand-crafted signed payload.

Happy to hop on a call if that's faster. Thanks!

---

**Once you have the answer**, the fix is a straightforward swap: replace
`WhatsappWebhookGuard`'s shared-secret check with real HMAC verification —
mirror `backend/src/payments/paystack-webhook.guard.ts` (`PaystackWebhookGuard`)
for the pattern (raw body via `app.rawBody`, constant-time compare, reject
on any mismatch or missing header/secret). Add a unit test that verifies a
hand-crafted, correctly-signed payload passes and a tampered one is rejected
— same rigor as the Paystack guard's own test.

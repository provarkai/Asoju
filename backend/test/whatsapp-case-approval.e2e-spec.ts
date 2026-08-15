import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, ensureHealthyApp } from './utils/bootstrap';
import { createCustomer, createStaff, createAgent, login, prisma } from './utils/fixtures';
import { Role } from '@prisma/client';

/**
 * Platform Expansion PRD §6.1 "Deeper WhatsApp-first case approval" — a
 * tapped Approve/Request-changes button routes straight to
 * CasesService.recordApproval instead of the AI concierge. Real app, real
 * Postgres, real webhook path (WHATSAPP_WEBHOOK_SECRET header) — no
 * shortcuts around the routing/authorization logic itself, only around the
 * evidence/QC chain to reach CUSTOMER_REVIEW (already covered by
 * qc-outcomes.e2e-spec.ts).
 */
describe('WhatsApp interactive-button case approval', () => {
  let app: INestApplication;

  let admin: Awaited<ReturnType<typeof createStaff>>;
  let adminToken: string;

  const WEBHOOK_SECRET = 'test-whatsapp-webhook-secret';

  beforeAll(async () => {
    process.env.WHATSAPP_WEBHOOK_SECRET = WEBHOOK_SECRET;
    app = await createTestApp();

    admin = await createStaff('whatsapp-approval-admin', Role.ADMIN);
    adminToken = await login(app, admin.email);
  });

  // See test/utils/bootstrap.ts's ensureHealthyApp — recovers from a
  // wedged shared `app` before the next test runs instead of letting a
  // mid-file connection reset poison every later test in this file.
  beforeEach(async () => {
    app = await ensureHealthyApp(app);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
    delete process.env.WHATSAPP_WEBHOOK_SECRET;
  });

  /** A customer with a phone, preferredChannel 'whatsapp', and an
   * established WhatsAppThread — the same "on WhatsApp" signal
   * NotificationsService already checks. */
  async function createWhatsAppCustomer(prefix: string) {
    const customer = await createCustomer(prefix);
    const phone = `+234${Math.floor(700_000_000 + Math.random() * 99_999_999)}`;
    await prisma.user.update({
      where: { id: customer.user.id },
      data: { phone, preferredChannel: 'whatsapp' },
    });
    await prisma.whatsAppThread.create({
      data: { phone, userId: customer.user.id, history: [] },
    });
    return { ...customer, phone };
  }

  /** Fast-forwards a fresh case to CUSTOMER_REVIEW for the given customer
   * — mirrors qc-outcomes.e2e-spec.ts's createCaseAtEvidenceSubmitted
   * helper (DB-shortcut past quote/payment) plus the QC approve step. */
  async function createCaseAtCustomerReview(customerToken: string): Promise<string> {
    const { agent, email: agentEmail } = await createAgent('whatsapp-approval-agent');
    const agentToken = await login(app, agentEmail);

    const reqRes = await request(app.getHttpServer())
      .post('/api/service-requests')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ rawDescription: 'WhatsApp approval test case', location: 'Lagos', channel: 'web' })
      .expect(201);
    const caseRes = await request(app.getHttpServer())
      .post(`/api/service-requests/${reqRes.body.id}/convert`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ serviceType: 'PROPERTY_INSPECTION', description: 'Inspect', location: 'Lagos', priority: 'STANDARD' })
      .expect(201);
    const caseId = caseRes.body.id;

    await prisma.serviceCase.update({ where: { id: caseId }, data: { status: 'SCHEDULED', paymentStatus: 'PAID' } });

    const assignRes = await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/assignments`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'FIELD_AGENT', agentId: agent.id })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/assignments/${assignRes.body.id}/accept`)
      .set('Authorization', `Bearer ${agentToken}`)
      .expect(201);

    const uploadRes = await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/evidence/upload-url`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ fileName: 'site.jpg', contentType: 'image/jpeg' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/evidence`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ type: 'PHOTO', storageKey: uploadRes.body.storageKey })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/evidence/complete`)
      .set('Authorization', `Bearer ${agentToken}`)
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/qc`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ outcome: 'APPROVED', summary: 'Inspection complete' })
      .expect(201);

    return caseId;
  }

  function tapButton(phone: string, buttonId: string) {
    return request(app.getHttpServer())
      .post('/api/webhooks/whatsapp')
      .set('x-webhook-secret', WEBHOOK_SECRET)
      .send({ from: phone, body: '(button tap)', interactiveReplyId: buttonId });
  }

  it('an Approve tap moves the case to COMPLETED and records the approval', async () => {
    const customer = await createWhatsAppCustomer('whatsapp-approve');
    const customerToken = await login(app, customer.email);
    const caseId = await createCaseAtCustomerReview(customerToken);

    const res = await tapButton(customer.phone, `case-approval:approve:${caseId}`).expect(201);
    expect(res.body.reply).toContain("approved the report");

    const caseRow = await prisma.serviceCase.findUniqueOrThrow({ where: { id: caseId } });
    expect(caseRow.status).toBe('COMPLETED');

    const approval = await prisma.approval.findFirst({ where: { caseId } });
    expect(approval?.action).toBe('APPROVED');
    expect(approval?.byUserId).toBe(customer.user.id);
  });

  it('a Request-changes tap moves the case to ADDITIONAL_WORK', async () => {
    const customer = await createWhatsAppCustomer('whatsapp-changes');
    const customerToken = await login(app, customer.email);
    const caseId = await createCaseAtCustomerReview(customerToken);

    const res = await tapButton(customer.phone, `case-approval:additional_work:${caseId}`).expect(201);
    expect(res.body.reply).toContain('additional work');

    const caseRow = await prisma.serviceCase.findUniqueOrThrow({ where: { id: caseId } });
    expect(caseRow.status).toBe('ADDITIONAL_WORK');

    const approval = await prisma.approval.findFirst({ where: { caseId } });
    expect(approval?.action).toBe('REQUEST_ADDITIONAL_WORK');
  });

  it('never lets a button reply act on a case that belongs to a different customer', async () => {
    const owner = await createWhatsAppCustomer('whatsapp-owner');
    const ownerToken = await login(app, owner.email);
    const caseId = await createCaseAtCustomerReview(ownerToken);

    const impostor = await createWhatsAppCustomer('whatsapp-impostor');

    const res = await tapButton(impostor.phone, `case-approval:approve:${caseId}`).expect(201);
    expect(res.body.reply).toBeNull();

    // The case is untouched — still CUSTOMER_REVIEW, no approval recorded
    // by the impostor.
    const caseRow = await prisma.serviceCase.findUniqueOrThrow({ where: { id: caseId } });
    expect(caseRow.status).toBe('CUSTOMER_REVIEW');
    const approval = await prisma.approval.findFirst({ where: { caseId, byUserId: impostor.user.id } });
    expect(approval).toBeNull();
  });

  it('rejects a webhook call with no/wrong secret entirely', async () => {
    const customer = await createWhatsAppCustomer('whatsapp-noauth');
    await request(app.getHttpServer())
      .post('/api/webhooks/whatsapp')
      .send({ from: customer.phone, body: 'hi' })
      .expect(401);
    await request(app.getHttpServer())
      .post('/api/webhooks/whatsapp')
      .set('x-webhook-secret', 'wrong-secret')
      .send({ from: customer.phone, body: 'hi' })
      .expect(401);
  });
});

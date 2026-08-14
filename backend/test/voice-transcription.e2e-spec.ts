import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Role } from '@prisma/client';
import { createTestApp } from './utils/bootstrap';
import { createCustomer, createStaff, createAgent, login, prisma } from './utils/fixtures';

/**
 * Ported from FieldForce's voice-translation.ts — Whisper transcription/
 * translation triggered on VOICE evidence submissions. No OPENAI_API_KEY
 * is set in CI, so this exercises the real dry-run path end to end
 * (submitEvidence -> VoiceTranscriptionService.transcribeEvidence, never
 * blocking the submission itself) — real-network transcription behaviour
 * is covered by voice-translation.spec.ts's mocked-fetch unit tests.
 */
describe('Voice evidence — transcription hook (dry run, no OPENAI_API_KEY in CI)', () => {
  let app: INestApplication;
  let customer: Awaited<ReturnType<typeof createCustomer>>;
  let admin: Awaited<ReturnType<typeof createStaff>>;
  let agent: Awaited<ReturnType<typeof createAgent>>;
  let customerToken: string;
  let adminToken: string;
  let agentToken: string;

  beforeAll(async () => {
    app = await createTestApp();
    [customer, admin, agent] = await Promise.all([
      createCustomer('voice-evidence'),
      createStaff('voice-evidence-admin', Role.ADMIN),
      createAgent('voice-evidence-agent'),
    ]);
    [customerToken, adminToken, agentToken] = await Promise.all([
      login(app, customer.email),
      login(app, admin.email),
      login(app, agent.email),
    ]);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  /** Fast-forwards a fresh case to IN_PROGRESS, with a real field-agent
   * assignment — the state evidence submission actually operates on
   * (same convention as qc-outcomes.e2e-spec.ts). */
  async function createCaseInProgress(): Promise<string> {
    const reqRes = await request(app.getHttpServer())
      .post('/api/service-requests')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ rawDescription: 'Voice evidence test case', location: 'Lagos', channel: 'web' })
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
      .send({ role: 'FIELD_AGENT', agentId: agent.agent.id })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/assignments/${assignRes.body.id}/accept`)
      .set('Authorization', `Bearer ${agentToken}`)
      .expect(201);

    return caseId;
  }

  it('submits VOICE evidence and comes back with a FAILED transcription status (dry run), never blocking submission', async () => {
    const caseId = await createCaseInProgress();

    const uploadRes = await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/evidence/upload-url`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ fileName: 'note.mp3', contentType: 'audio/mpeg' })
      .expect(201);

    const evidenceRes = await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/evidence`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ type: 'VOICE', storageKey: uploadRes.body.storageKey, languageHint: 'yo' })
      .expect(201);

    // The submission itself succeeds (201) even though transcription
    // couldn't run — dry run without OPENAI_API_KEY never throws.
    expect(evidenceRes.body).toMatchObject({
      type: 'VOICE',
      transcriptionStatus: 'FAILED',
      translationStatus: 'NOT_REQUESTED',
      transcript: null,
      translatedText: null,
    });
  });

  it('stores the languageHint only for VOICE evidence, ignoring it for other types', async () => {
    const caseId = await createCaseInProgress();

    const photoUploadRes = await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/evidence/upload-url`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ fileName: 'site.jpg', contentType: 'image/jpeg' })
      .expect(201);
    const photoRes = await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/evidence`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ type: 'PHOTO', storageKey: photoUploadRes.body.storageKey, languageHint: 'yo' })
      .expect(201);

    expect(photoRes.body.languageHint).toBeNull();
    expect(photoRes.body.transcriptionStatus).toBe('NOT_REQUESTED');
    expect(photoRes.body.translationStatus).toBe('NOT_REQUESTED');
  });

  it('a VOICE evidence submission without a languageHint still works (auto-detect path)', async () => {
    const caseId = await createCaseInProgress();

    const uploadRes = await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/evidence/upload-url`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ fileName: 'note.webm', contentType: 'audio/webm' })
      .expect(201);

    const evidenceRes = await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/evidence`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ type: 'VOICE', storageKey: uploadRes.body.storageKey })
      .expect(201);

    expect(evidenceRes.body.languageHint).toBeNull();
    expect(evidenceRes.body.transcriptionStatus).toBe('FAILED');
  });
});

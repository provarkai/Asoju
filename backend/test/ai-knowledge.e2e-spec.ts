import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, ensureHealthyApp, withSetupRetry } from './utils/bootstrap';
import { createCustomer, createStaff, login, prisma } from './utils/fixtures';
import { Role } from '@prisma/client';

/**
 * "There should be a way we tell or teach the AI the prices and customer
 * service, and deep knowledge of what we are doing." Covers the admin
 * CRUD surface (backend-only for the first cut — same resolved precedent
 * as AutomationAdminService: real, incremental value today; a dedicated
 * admin screen is a fair follow-up, not a blocker) plus the real-data
 * pricing summary AiKnowledgeService.buildContextBlock() reads from.
 * buildContextBlock()'s own formatting/combination logic is covered by
 * the colocated unit test (ai-knowledge.service.spec.ts, mocked I/O) —
 * this file proves the HTTP layer, real auth, and real Postgres persistence.
 */
describe('AI knowledge base admin (Phase 4 — "teach the AI")', () => {
  let app: INestApplication;

  let customer: Awaited<ReturnType<typeof createCustomer>>;
  let caseManager: Awaited<ReturnType<typeof createStaff>>;
  let customerToken: string;
  let staffToken: string;

  beforeAll(async () => {
    await withSetupRetry(async () => {
      app = await createTestApp();
      [customer, caseManager] = await Promise.all([
        createCustomer('ai-knowledge'),
        createStaff('ai-knowledge-cm', Role.CASE_MANAGER),
      ]);
      [customerToken, staffToken] = await Promise.all([login(app, customer.email), login(app, caseManager.email)]);
    });
  });

  beforeEach(async () => {
    app = await ensureHealthyApp(app);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('rejects a customer from reading or writing knowledge entries — this is staff-only content authoring', async () => {
    await request(app.getHttpServer())
      .get('/api/admin/ai-knowledge')
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(403);

    await request(app.getHttpServer())
      .post('/api/admin/ai-knowledge')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ category: 'FAQ', title: 'Q', content: 'A' })
      .expect(403);
  });

  it('lets a case manager create, list, update, and delete a knowledge entry — real Postgres persistence, not just a 201', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/api/admin/ai-knowledge')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ category: 'POLICY', title: 'Refund window', content: 'Refunds are available within 14 days of payment.' })
      .expect(201);
    const entryId = createRes.body.id;

    const persisted = await prisma.aiKnowledgeEntry.findUniqueOrThrow({ where: { id: entryId } });
    expect(persisted.title).toBe('Refund window');
    expect(persisted.isActive).toBe(true); // default, never asked for explicitly above

    const listRes = await request(app.getHttpServer())
      .get('/api/admin/ai-knowledge')
      .set('Authorization', `Bearer ${staffToken}`)
      .expect(200);
    expect(listRes.body.some((e: { id: string }) => e.id === entryId)).toBe(true);

    await request(app.getHttpServer())
      .patch(`/api/admin/ai-knowledge/${entryId}`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ isActive: false })
      .expect(200);
    const afterUpdate = await prisma.aiKnowledgeEntry.findUniqueOrThrow({ where: { id: entryId } });
    expect(afterUpdate.isActive).toBe(false);

    await request(app.getHttpServer())
      .delete(`/api/admin/ai-knowledge/${entryId}`)
      .set('Authorization', `Bearer ${staffToken}`)
      .expect(200);
    const afterDelete = await prisma.aiKnowledgeEntry.findUnique({ where: { id: entryId } });
    expect(afterDelete).toBeNull();

    // Every write is audited under the acting staff member, never anonymous.
    const auditRows = await prisma.auditEvent.findMany({
      where: { action: { in: ['ai_knowledge.created', 'ai_knowledge.updated', 'ai_knowledge.deleted'] }, actorId: caseManager.user.id },
    });
    expect(auditRows.map((r) => r.action).sort()).toEqual(['ai_knowledge.created', 'ai_knowledge.deleted', 'ai_knowledge.updated']);
  });

  it('404s updating or deleting an entry that does not exist, instead of silently succeeding', async () => {
    await request(app.getHttpServer())
      .patch('/api/admin/ai-knowledge/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ title: 'Anything' })
      .expect(404);

    await request(app.getHttpServer())
      .delete('/api/admin/ai-knowledge/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${staffToken}`)
      .expect(404);
  });

  it('rejects an unknown category rather than persisting free-text junk', async () => {
    await request(app.getHttpServer())
      .post('/api/admin/ai-knowledge')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ category: 'NOT_A_REAL_CATEGORY', title: 'Q', content: 'A' })
      .expect(400);
  });
});

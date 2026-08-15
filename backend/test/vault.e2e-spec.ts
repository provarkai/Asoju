import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, ensureHealthyApp, withSetupRetry } from './utils/bootstrap';
import { createCustomer, createStaff, login, prisma } from './utils/fixtures';
import { Role } from '@prisma/client';

/**
 * Section 4.1/4.2 — customer document vault + staff-verified reusable
 * legal assets, independent of any case. Real app, real Postgres.
 */
describe('Customer document vault', () => {
  let app: INestApplication;

  let customerA: Awaited<ReturnType<typeof createCustomer>>;
  let customerB: Awaited<ReturnType<typeof createCustomer>>;
  let caseManager: Awaited<ReturnType<typeof createStaff>>;

  let tokenA: string;
  let tokenB: string;
  let caseManagerToken: string;

  beforeAll(async () => {
    await withSetupRetry(async () => {
      app = await createTestApp();

      [customerA, customerB, caseManager] = await Promise.all([
        createCustomer('vault-a'),
        createCustomer('vault-b'),
        createStaff('vault-cm', Role.CASE_MANAGER),
      ]);
      [tokenA, tokenB, caseManagerToken] = await Promise.all([
        login(app, customerA.email),
        login(app, customerB.email),
        login(app, caseManager.email),
      ]);

    });
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
  });

  it('adds a metadata-only vault document (no file) and lists it back', async () => {
    const added = await request(app.getHttpServer())
      .post('/api/me/vault-documents')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ name: 'Deed of assignment — Ibeju-Lekki', category: 'TITLE_DEED', notes: 'Original with lawyer' })
      .expect(201);
    expect(added.body.isVerified).toBe(false);
    expect(added.body.storageKey).toBeNull();

    const list = await request(app.getHttpServer())
      .get('/api/me/vault-documents')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].name).toBe('Deed of assignment — Ibeju-Lekki');
  });

  it('uploads a real file via the presign-then-verify flow', async () => {
    const uploadUrl = await request(app.getHttpServer())
      .post('/api/me/vault-documents/upload-url')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ fileName: 'passport.pdf', contentType: 'application/pdf' })
      .expect(201);
    expect(uploadUrl.body.storageKey).toMatch(/^vault\//);

    const added = await request(app.getHttpServer())
      .post('/api/me/vault-documents')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        name: 'Passport copy',
        category: 'IDENTITY',
        storageKey: uploadUrl.body.storageKey,
        fileName: 'passport.pdf',
        fileSize: 12345,
      })
      .expect(201);
    expect(added.body.storageKey).toBe(uploadUrl.body.storageKey);
  });

  it('rejects a storageKey that was not issued to this customer', async () => {
    await request(app.getHttpServer())
      .post('/api/me/vault-documents')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ name: 'Forged path', storageKey: 'vault/someone-elses-customer-id/evil.pdf' })
      .expect(400);
  });

  it('a customer cannot see or delete another customer\'s vault documents', async () => {
    const added = await request(app.getHttpServer())
      .post('/api/me/vault-documents')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ name: 'Customer A private doc' })
      .expect(201);

    const listB = await request(app.getHttpServer())
      .get('/api/me/vault-documents')
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(200);
    expect(listB.body.find((d: { id: string }) => d.id === added.body.id)).toBeUndefined();

    await request(app.getHttpServer())
      .delete(`/api/me/vault-documents/${added.body.id}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(403);
  });

  it('deletes a vault document', async () => {
    const added = await request(app.getHttpServer())
      .post('/api/me/vault-documents')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ name: 'To be deleted' })
      .expect(201);

    await request(app.getHttpServer())
      .delete(`/api/me/vault-documents/${added.body.id}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    const list = await request(app.getHttpServer())
      .get('/api/me/vault-documents')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    expect(list.body.find((d: { id: string }) => d.id === added.body.id)).toBeUndefined();
  });

  it('submits a verified asset unverified, then staff verifies it', async () => {
    const submitted = await request(app.getHttpServer())
      .post('/api/me/verified-assets')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ type: 'POWER_OF_ATTORNEY', name: 'PoA — Mrs. Adaeze Okonkwo' })
      .expect(201);
    expect(submitted.body.verified).toBe(false);

    // A customer cannot self-verify.
    await request(app.getHttpServer())
      .patch(`/api/admin/verified-assets/${submitted.body.id}/verify`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(403);

    const verified = await request(app.getHttpServer())
      .patch(`/api/admin/verified-assets/${submitted.body.id}/verify`)
      .set('Authorization', `Bearer ${caseManagerToken}`)
      .expect(200);
    expect(verified.body.verified).toBe(true);
    expect(verified.body.verifiedAt).toBeTruthy();

    const list = await request(app.getHttpServer())
      .get('/api/me/verified-assets')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    expect(list.body.find((a: { id: string }) => a.id === submitted.body.id)?.verified).toBe(true);
  });

  it('records a vault_document.added audit event for this document', async () => {
    const doc = await request(app.getHttpServer())
      .post('/api/me/vault-documents')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ name: 'Audit trail check' })
      .expect(201);
    const events = await prisma.auditEvent.findMany({
      where: { action: 'vault_document.added', actorId: customerA.user.id },
      orderBy: { createdAt: 'desc' },
      take: 1,
    });
    expect(events).toHaveLength(1);
    expect((events[0].metadata as { documentId?: string }).documentId).toBe(doc.body.id);
  });
});

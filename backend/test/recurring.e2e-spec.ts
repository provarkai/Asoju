import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, ensureHealthyApp, withSetupRetry } from './utils/bootstrap';
import { createCustomer, createStaff, login, prisma } from './utils/fixtures';
import { Role } from '@prisma/client';

/**
 * Section 12 P1 "recurring services". No e2e coverage existed for this
 * module at all before this spec. Focus: the pause/resume offset fix — a
 * paused schedule used to lose whatever time was left until `nextRunAt`
 * and reset to a full `cadenceDays` on resume; it now resumes with exactly
 * the time that was left when it was paused.
 */
describe('Recurring services', () => {
  let app: INestApplication;

  let customer: Awaited<ReturnType<typeof createCustomer>>;
  let admin: Awaited<ReturnType<typeof createStaff>>;
  let customerToken: string;
  let adminToken: string;

  beforeAll(async () => {
    await withSetupRetry(async () => {
      app = await createTestApp();
      [customer, admin] = await Promise.all([createCustomer('recur'), createStaff('recur-admin', Role.ADMIN)]);
      [customerToken, adminToken] = await Promise.all([login(app, customer.email), login(app, admin.email)]);
    });
  });

  beforeEach(async () => {
    app = await ensureHealthyApp(app);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  /** Drives a case to COMPLETED — walking the full state machine isn't this
   * spec's concern (authorization.e2e-spec.ts and the qc/report suites
   * already exercise it), same fast-forward pattern as portfolio.e2e-spec.ts. */
  async function createCompletedCase(): Promise<string> {
    const reqRes = await request(app.getHttpServer())
      .post('/api/service-requests')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ rawDescription: 'Recurring test case', location: 'Lagos', channel: 'web' })
      .expect(201);
    const caseRes = await request(app.getHttpServer())
      .post(`/api/service-requests/${reqRes.body.id}/convert`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        serviceType: 'CONSTRUCTION_SUPERVISION',
        description: 'Site visit',
        location: 'Lagos',
        priority: 'STANDARD',
      })
      .expect(201);
    const caseId = caseRes.body.id;
    await prisma.serviceCase.update({ where: { id: caseId }, data: { status: 'COMPLETED' } });
    return caseId;
  }

  function setup(caseId: string, cadenceDays: number) {
    return request(app.getHttpServer())
      .post(`/api/cases/${caseId}/recurrence`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ cadenceDays });
  }

  function setActive(caseId: string, active: boolean) {
    return request(app.getHttpServer())
      .patch(`/api/cases/${caseId}/recurrence`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ active });
  }

  it('creates a schedule with nextRunAt cadenceDays out', async () => {
    const caseId = await createCompletedCase();
    const res = await setup(caseId, 10).expect(201);

    const expected = Date.now() + 10 * 24 * 60 * 60 * 1000;
    expect(Math.abs(new Date(res.body.nextRunAt).getTime() - expected)).toBeLessThan(5000);
    expect(res.body.active).toBe(true);
  });

  it('resumes a paused schedule with the exact time left when it was paused, not a reset cadence', async () => {
    const caseId = await createCompletedCase();
    const created = await setup(caseId, 30).expect(201);
    const scheduleId = created.body.id;

    // Simulate "9 days into a 30-day cadence, then paused" by writing the
    // schedule's state directly rather than waiting 9 real days.
    const pausedAt = new Date();
    const nextRunAt = new Date(pausedAt.getTime() + 21 * 24 * 60 * 60 * 1000); // 21 days still remaining
    await prisma.recurringSchedule.update({
      where: { id: scheduleId },
      data: { active: false, pausedAt, nextRunAt },
    });

    const resumed = await setActive(caseId, true).expect(200);
    expect(resumed.body.active).toBe(true);
    expect(resumed.body.pausedAt).toBeNull();

    const expectedNextRunAt = Date.now() + 21 * 24 * 60 * 60 * 1000;
    expect(Math.abs(new Date(resumed.body.nextRunAt).getTime() - expectedNextRunAt)).toBeLessThan(5000);
  });

  it('resumes a schedule that was already overdue when paused immediately, not after a fresh cadence', async () => {
    const caseId = await createCompletedCase();
    const created = await setup(caseId, 14).expect(201);
    const scheduleId = created.body.id;

    const pausedAt = new Date();
    const nextRunAt = new Date(pausedAt.getTime() - 2 * 24 * 60 * 60 * 1000); // already 2 days overdue
    await prisma.recurringSchedule.update({
      where: { id: scheduleId },
      data: { active: false, pausedAt, nextRunAt },
    });

    const resumed = await setActive(caseId, true).expect(200);
    // Clamped to "now", never negative and never a fresh 14-day wait.
    expect(Math.abs(new Date(resumed.body.nextRunAt).getTime() - Date.now())).toBeLessThan(5000);
  });

  it('rejects pausing an already-paused schedule', async () => {
    const caseId = await createCompletedCase();
    await setup(caseId, 30).expect(201);
    await setActive(caseId, false).expect(200);
    await setActive(caseId, false).expect(400);
  });

  it('rejects resuming an already-active schedule', async () => {
    const caseId = await createCompletedCase();
    await setup(caseId, 30).expect(201);
    await setActive(caseId, true).expect(400);
  });

  it('the manual sweep spawns a new case from a due schedule', async () => {
    const caseId = await createCompletedCase();
    const created = await setup(caseId, 30).expect(201);
    // Force it due now rather than waiting for the cadence.
    await prisma.recurringSchedule.update({ where: { id: created.body.id }, data: { nextRunAt: new Date() } });

    await request(app.getHttpServer())
      .post('/api/admin/recurring/run')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201);

    const spawned = await prisma.serviceCase.findFirst({ where: { spawnedFromScheduleId: created.body.id } });
    expect(spawned).not.toBeNull();

    const schedule = await prisma.recurringSchedule.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(schedule.nextRunAt.getTime()).toBeGreaterThan(Date.now());
  });
});

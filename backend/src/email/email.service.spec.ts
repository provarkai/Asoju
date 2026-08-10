import { EmailService } from './email.service';

describe('EmailService — Resend integration', () => {
  const ORIGINAL_ENV = process.env;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
    jest.restoreAllMocks();
  });

  it('runs in dry-run mode with no API key configured, and never calls fetch', async () => {
    delete process.env.RESEND_API_KEY;
    const service = new EmailService();

    const result = await service.sendEmail('customer@example.com', 'Subject', '<p>Body</p>');

    expect(result).toEqual({ sent: false, dryRun: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends a real request to Resend with the documented shape when configured', async () => {
    process.env.RESEND_API_KEY = 're_test_abc123';
    fetchMock.mockResolvedValue({ ok: true, text: async () => '', json: async () => ({ id: 'email_1' }) });
    const service = new EmailService();

    const result = await service.sendEmail('customer@example.com', 'Reset your password', '<p>Link</p>');

    expect(result).toEqual({ sent: true, dryRun: false });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.resend.com/emails',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer re_test_abc123' }),
      }),
    );
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toEqual({
      from: 'ASOJU <onboarding@resend.dev>',
      to: 'customer@example.com',
      subject: 'Reset your password',
      html: '<p>Link</p>',
    });
  });

  it('uses RESEND_FROM_EMAIL when set, instead of the shared default sender', async () => {
    process.env.RESEND_API_KEY = 're_test_abc123';
    process.env.RESEND_FROM_EMAIL = 'ASOJU <no-reply@asoju.example>';
    fetchMock.mockResolvedValue({ ok: true, text: async () => '' });
    const service = new EmailService();

    await service.sendEmail('customer@example.com', 'Subject', '<p>Body</p>');

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.from).toBe('ASOJU <no-reply@asoju.example>');
  });

  it('treats a non-2xx response as a failed (not dry-run) send', async () => {
    process.env.RESEND_API_KEY = 're_test_abc123';
    fetchMock.mockResolvedValue({ ok: false, status: 403, text: async () => '{"message":"restricted"}' });
    const service = new EmailService();

    const result = await service.sendEmail('customer@example.com', 'Subject', '<p>Body</p>');

    expect(result).toEqual({ sent: false, dryRun: false });
  });
});

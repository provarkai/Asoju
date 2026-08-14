import { WhatsappSenderService } from './whatsapp-sender.service';

describe('WhatsappSenderService — Zavu integration', () => {
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
    delete process.env.ZAVU_API_KEY;
    const service = new WhatsappSenderService();

    const result = await service.sendMessage('+2348012345678', 'hello');

    expect(result).toEqual({ sent: false, dryRun: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends a real request to Zavu with the documented shape when configured', async () => {
    process.env.ZAVU_API_KEY = 'zv_test_abc123';
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ message: { id: 'msg_1', status: 'queued' } }),
    });
    const service = new WhatsappSenderService();

    const result = await service.sendMessage('+2348012345678', 'hello there');

    expect(result).toEqual({ sent: true, dryRun: false });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.zavu.dev/v1/messages',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer zv_test_abc123' }),
      }),
    );
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toEqual({ to: '+2348012345678', channel: 'whatsapp', text: 'hello there', fallbackEnabled: false });
  });

  it('adds the Zavu-Sender header only when ZAVU_SENDER_ID is set', async () => {
    process.env.ZAVU_API_KEY = 'zv_test_abc123';
    process.env.ZAVU_SENDER_ID = 'snd_xyz';
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ message: { id: 'msg_1', status: 'queued' } }) });
    const service = new WhatsappSenderService();

    await service.sendMessage('+2348012345678', 'hi');

    const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers['Zavu-Sender']).toBe('snd_xyz');
  });

  it('treats a non-2xx response as a failed (not dry-run) send', async () => {
    process.env.ZAVU_API_KEY = 'zv_test_abc123';
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ code: 'unauthorized', message: 'Invalid API key' }),
    });
    const service = new WhatsappSenderService();

    const result = await service.sendMessage('+2348012345678', 'hi');

    expect(result).toEqual({ sent: false, dryRun: false });
  });

  it('treats a 2xx response carrying a downstream errorCode as a failed send', async () => {
    process.env.ZAVU_API_KEY = 'zv_test_abc123';
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ message: { id: 'msg_1', status: 'failed', errorCode: 'invalid_number', errorMessage: 'bad number' } }),
    });
    const service = new WhatsappSenderService();

    const result = await service.sendMessage('+2348012345678', 'hi');

    expect(result).toEqual({ sent: false, dryRun: false });
  });

  it('never enables SMS fallback — a conversational AI reply should not silently reroute channels', async () => {
    process.env.ZAVU_API_KEY = 'zv_test_abc123';
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ message: { id: 'msg_1', status: 'queued' } }) });
    const service = new WhatsappSenderService();

    await service.sendMessage('+2348012345678', 'hi');

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.fallbackEnabled).toBe(false);
  });

  describe('sendApprovalRequest — Platform Expansion PRD §6.1', () => {
    const buttons = [
      { id: 'case-approval:approve:case-1', title: 'Approve report' },
      { id: 'case-approval:additional_work:case-1', title: 'Request changes' },
    ];

    it('runs in dry-run mode with no API key configured, and never calls fetch', async () => {
      delete process.env.ZAVU_API_KEY;
      const service = new WhatsappSenderService();

      const result = await service.sendApprovalRequest('+2348012345678', 'ASJ-000123', buttons);

      expect(result).toEqual({ sent: false, dryRun: true });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('sends an interactive button message with both button ids intact', async () => {
      process.env.ZAVU_API_KEY = 'zv_test_abc123';
      fetchMock.mockResolvedValue({ ok: true, json: async () => ({ message: { id: 'msg_1', status: 'queued' } }) });
      const service = new WhatsappSenderService();

      const result = await service.sendApprovalRequest('+2348012345678', 'ASJ-000123', buttons);

      expect(result).toEqual({ sent: true, dryRun: false });
      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
      expect(body.type).toBe('interactive');
      expect(body.interactive.type).toBe('button');
      expect(body.interactive.body.text).toContain('ASJ-000123');
      expect(body.interactive.action.buttons).toEqual([
        { type: 'reply', reply: { id: 'case-approval:approve:case-1', title: 'Approve report' } },
        { type: 'reply', reply: { id: 'case-approval:additional_work:case-1', title: 'Request changes' } },
      ]);
      expect(body.fallbackEnabled).toBe(false);
    });

    it('treats a non-2xx response as a failed (not dry-run) send, same as sendMessage', async () => {
      process.env.ZAVU_API_KEY = 'zv_test_abc123';
      fetchMock.mockResolvedValue({ ok: false, status: 401, json: async () => ({ code: 'unauthorized', message: 'bad key' }) });
      const service = new WhatsappSenderService();

      const result = await service.sendApprovalRequest('+2348012345678', 'ASJ-000123', buttons);

      expect(result).toEqual({ sent: false, dryRun: false });
    });
  });
});

import { NotificationsService } from './notifications.service';

/**
 * "the subscriptions/quotes are sent through their dashboard AND
 * WhatsApp with links to make payment" — the dashboard half already
 * worked (NotificationBell renders Notification.actionUrl as a Next.js
 * <Link>), but attemptChannelFanOut's WhatsApp branch only ever sent
 * `title\n\nbody`, silently dropping actionUrl. These tests pin the fix:
 * a same-origin relative actionUrl gets resolved to an absolute URL
 * (FRONTEND_URL) and appended to the WhatsApp message text, and nothing
 * changes when there's no actionUrl to send.
 */
describe('NotificationsService — WhatsApp actionUrl fan-out', () => {
  const ORIGINAL_ENV = process.env;
  let prisma: any;
  let audit: any;
  let whatsappSender: any;
  let emailService: any;
  let service: NotificationsService;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV, FRONTEND_URL: 'https://app.asoju.example' };

    prisma = {
      notification: {
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'notif-1', ...data })),
        update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'notif-1', ...data })),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'user-1',
          phone: '+2348012345678',
          email: 'customer@example.com',
          preferredChannel: 'whatsapp',
        }),
      },
    };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    whatsappSender = {
      isConfigured: jest.fn().mockReturnValue(true),
      sendMessage: jest.fn().mockResolvedValue({ sent: true, dryRun: false }),
    };
    emailService = { isConfigured: jest.fn().mockReturnValue(false), sendEmail: jest.fn() };

    service = new NotificationsService(prisma, audit, whatsappSender, emailService);
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it('appends the resolved absolute URL to the WhatsApp message when actionUrl is present', async () => {
    await service.notify('user-1', 'Your quote is ready', 'Review and accept it to get scheduled.', '/dashboard/cases/case-1');

    expect(whatsappSender.sendMessage).toHaveBeenCalledWith(
      '+2348012345678',
      'Your quote is ready\n\nReview and accept it to get scheduled.\n\nhttps://app.asoju.example/dashboard/cases/case-1',
    );
  });

  it('sends title+body unchanged with no trailing link when actionUrl is omitted', async () => {
    await service.notify('user-1', 'Heads up', 'Just an update, nothing to click.');

    expect(whatsappSender.sendMessage).toHaveBeenCalledWith('+2348012345678', 'Heads up\n\nJust an update, nothing to click.');
  });

  it('falls back to localhost:3000 when FRONTEND_URL is not configured', async () => {
    delete process.env.FRONTEND_URL;

    await service.notify('user-1', 'Your quote is ready', 'Body', '/dashboard/cases/case-1');

    expect(whatsappSender.sendMessage).toHaveBeenCalledWith(
      '+2348012345678',
      'Your quote is ready\n\nBody\n\nhttp://localhost:3000/dashboard/cases/case-1',
    );
  });
});

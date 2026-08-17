import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Notification, NotificationDeliveryStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { WhatsappSenderService } from '../whatsapp/whatsapp-sender.service';
import { EmailService } from '../email/email.service';

/**
 * In-app notifications (Section 5.1 P1 — "notification preferences").
 * Every call still creates the in-app inbox row first, unconditionally —
 * that part hasn't changed. What's new: P0 API Specification &
 * Integration Contracts v1.0 §30 "Notification APIs" —
 * `POST /notifications/{id}/retry`. Customers have picked a
 * preferredChannel (User.preferredChannel) since Section 5.1 P1 shipped
 * with nowhere real that fed into — this was the exact gap this file's
 * own comment used to name: "no email/SMS/WhatsApp fan-out yet." notify()
 * now actually attempts a real send on that channel whenever its provider
 * is configured (WhatsappSenderService/EmailService — dry-run-safe, same
 * as every other integration in this repo), recording the outcome.
 * Nothing changes when no provider is configured: channel stays null,
 * deliveryStatus stays the default SENT — never a false FAILED for a send
 * that was never attempted.
 */
@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly whatsappSender: WhatsappSenderService,
    private readonly emailService: EmailService,
  ) {}

  /** `actionUrl` is optional and additive — every existing call site
   * keeps working with no link. Only set it where there's a real
   * same-origin destination for the recipient to click through to (see
   * Notification.actionUrl's schema comment; AgentSosService.notifyAdmins
   * is the first real caller). */
  async notify(userId: string, title: string, body: string, actionUrl?: string) {
    const notification = await this.prisma.notification.create({ data: { userId, title, body, actionUrl } });
    return this.attemptChannelFanOut(notification);
  }

  /** Shared by notify() (first attempt) and retryDelivery() (staff-
   * triggered re-attempt) — the send logic is identical either way, only
   * who/when triggers it differs. */
  private async attemptChannelFanOut(notification: Notification): Promise<Notification> {
    const user = await this.prisma.user.findUnique({ where: { id: notification.userId } });
    if (!user) return notification;

    let result: { sent: boolean } | null = null;
    let channel: string | null = null;

    if (user.preferredChannel === 'whatsapp' && user.phone && this.whatsappSender.isConfigured()) {
      channel = 'whatsapp';
      result = await this.whatsappSender.sendMessage(user.phone, `${notification.title}\n\n${notification.body}`);
    } else if (user.preferredChannel === 'email' && user.email && this.emailService.isConfigured()) {
      channel = 'email';
      result = await this.emailService.sendEmail(user.email, notification.title, `<p>${notification.body}</p>`);
    }

    // No configured channel applies — in-app only, exactly as before this
    // feature existed. Not a failure; nothing was attempted.
    if (!result || !channel) return notification;

    return this.prisma.notification.update({
      where: { id: notification.id },
      data: result.sent
        ? { channel, deliveryStatus: NotificationDeliveryStatus.SENT, failureReason: null }
        : { channel, deliveryStatus: NotificationDeliveryStatus.FAILED, failureReason: `${channel} delivery failed` },
    });
  }

  /** P0 API Spec §30 — `POST /notifications/{id}/retry`. Staff-triggered;
   * only meaningful for a notification that actually failed a real
   * channel attempt (not one that was always in-app-only). */
  async retryDelivery(actorId: string, notificationId: string) {
    const notification = await this.prisma.notification.findUnique({ where: { id: notificationId } });
    if (!notification) throw new NotFoundException('Notification not found');
    if (notification.deliveryStatus !== NotificationDeliveryStatus.FAILED) {
      throw new BadRequestException('This notification is not in a failed delivery state');
    }

    const result = await this.attemptChannelFanOut(notification);

    await this.audit.record({
      actorId,
      actorType: 'user',
      action: 'notification.retried',
      metadata: { notificationId, channel: result.channel, deliveryStatus: result.deliveryStatus },
    });

    return result;
  }

  /** Staff-facing failed-delivery queue — the thing to retry. */
  async listFailed() {
    return this.prisma.notification.findMany({
      where: { deliveryStatus: NotificationDeliveryStatus.FAILED },
      include: { user: { select: { email: true, phone: true, preferredChannel: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async listForUser(userId: string) {
    return this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async markRead(userId: string, notificationId: string) {
    const result = await this.prisma.notification.updateMany({
      where: { id: notificationId, userId },
      data: { readAt: new Date() },
    });
    return { updated: result.count > 0 };
  }

  async markAllRead(userId: string) {
    await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
  }
}

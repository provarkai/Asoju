import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { BeneficiaryRelayMessageType, CollaboratorRole, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { CreateRelayMessageDto } from './dto/create-relay-message.dto';

/**
 * Platform Expansion PRD §4.4 "Two-Way Beneficiary Relay" — see the
 * BeneficiaryRelayMessage schema comment for the access model. Controller
 * guards (@Roles + CaseAccessGuard) already keep FIELD_AGENT/PROVIDER off
 * every route here entirely; this service only has to decide, for the
 * two roles that *do* reach it, which side of the thread they're on.
 */
@Injectable()
export class BeneficiaryRelayService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async listMessages(caseId: string) {
    return this.prisma.beneficiaryRelayMessage.findMany({
      where: { caseId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        fromBeneficiary: true,
        type: true,
        body: true,
        acknowledgedAt: true,
        createdAt: true,
      },
    });
  }

  async sendMessage(actor: AuthenticatedUser, caseId: string, dto: CreateRelayMessageDto) {
    const serviceCase = await this.prisma.serviceCase.findUnique({
      where: { id: caseId },
      include: { beneficiary: true },
    });
    if (!serviceCase) throw new NotFoundException('Case not found');

    const fromBeneficiary = actor.role === Role.BENEFICIARY;
    const type = dto.type ?? BeneficiaryRelayMessageType.MESSAGE;

    const message = await this.prisma.beneficiaryRelayMessage.create({
      data: {
        caseId,
        senderId: actor.id,
        fromBeneficiary,
        type,
        body: dto.body,
      },
    });

    await this.audit.record({
      caseId,
      actorId: actor.id,
      actorType: 'user',
      action: fromBeneficiary ? 'beneficiary_relay.message_from_beneficiary' : 'beneficiary_relay.message_from_staff',
      metadata: { messageId: message.id, type },
    });

    if (fromBeneficiary) {
      // §4.4 "Messages flow to the CaseManager for triage" — the case
      // owner (CasesService's "who owns it" concept) if one's assigned,
      // otherwise every explicit CASE_MANAGER collaborator on the case.
      // Never the field agent/provider — they're not on this thread.
      const recipientIds = serviceCase.ownerUserId
        ? [serviceCase.ownerUserId]
        : (
            await this.prisma.caseCollaborator.findMany({
              where: { caseId, role: CollaboratorRole.CASE_MANAGER },
              select: { userId: true },
            })
          ).map((c) => c.userId);

      const title = type === BeneficiaryRelayMessageType.OBJECTION ? 'Beneficiary raised an objection' : 'New message from a beneficiary';
      await Promise.all(
        recipientIds.map((userId) => this.notifications.notify(userId, title, `Case ${serviceCase.caseNumber}: "${dto.body}"`)),
      );
    } else if (serviceCase.beneficiary?.userId) {
      await this.notifications.notify(
        serviceCase.beneficiary.userId,
        'Reply from your case team',
        `Case ${serviceCase.caseNumber}: "${dto.body}"`,
      );
    }

    return message;
  }

  /** Staff-only — marks an OBJECTION as triaged. A plain MESSAGE has
   * nothing to acknowledge; a beneficiary's own messages can't be
   * acknowledged by the beneficiary themselves (the guards keep them off
   * this method's controller route entirely, but the checks below hold
   * even if that ever changes). */
  async acknowledgeMessage(actor: AuthenticatedUser, caseId: string, messageId: string) {
    const message = await this.prisma.beneficiaryRelayMessage.findUnique({ where: { id: messageId } });
    if (!message || message.caseId !== caseId) throw new NotFoundException('Message not found');
    if (!message.fromBeneficiary) {
      throw new BadRequestException('Only a beneficiary-sent message can be acknowledged');
    }
    if (message.type !== BeneficiaryRelayMessageType.OBJECTION) {
      throw new BadRequestException('Only an objection can be acknowledged');
    }
    if (message.acknowledgedAt) {
      return message; // idempotent, same convention as ScopeService.confirm
    }

    const updated = await this.prisma.beneficiaryRelayMessage.update({
      where: { id: messageId },
      data: { acknowledgedAt: new Date(), acknowledgedById: actor.id },
    });

    await this.audit.record({
      caseId,
      actorId: actor.id,
      actorType: 'user',
      action: 'beneficiary_relay.objection_acknowledged',
      metadata: { messageId },
    });

    return updated;
  }
}

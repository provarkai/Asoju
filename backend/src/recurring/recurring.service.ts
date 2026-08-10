import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CaseStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CasesService } from '../cases/cases.service';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';

/**
 * Section 12 P1 "recurring services" — Section 6 Service 2 (Construction
 * Supervision) is explicitly "the first recurring-revenue product": each
 * scheduled visit produces comparable before/after evidence. A schedule is
 * set up from a completed case and then spawns follow-up cases on its own
 * cadence (see RecurringSchedulerService for the cron trigger).
 */
@Injectable()
export class RecurringService {
  private readonly logger = new Logger(RecurringService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly casesService: CasesService,
  ) {}

  async setup(actor: AuthenticatedUser, caseId: string, cadenceDays: number) {
    const serviceCase = await this.prisma.serviceCase.findUnique({
      where: { id: caseId },
      include: { recurringSchedule: true },
    });
    if (!serviceCase) throw new NotFoundException('Case not found');

    const eligibleStatuses: CaseStatus[] = [CaseStatus.COMPLETED, CaseStatus.CLOSED];
    if (!eligibleStatuses.includes(serviceCase.status)) {
      throw new BadRequestException('A recurring schedule can only be set up from a completed case');
    }
    if (serviceCase.recurringSchedule) {
      throw new BadRequestException(
        'This case already has a recurring schedule — use the reactivate/cancel actions instead',
      );
    }

    const nextRunAt = new Date(Date.now() + cadenceDays * 24 * 60 * 60 * 1000);
    const schedule = await this.prisma.recurringSchedule.create({
      data: {
        originCaseId: caseId,
        customerId: serviceCase.customerId,
        serviceType: serviceCase.serviceType,
        description: serviceCase.description,
        location: serviceCase.location,
        beneficiaryId: serviceCase.beneficiaryId,
        propertyId: serviceCase.propertyId,
        assetId: serviceCase.assetId,
        cadenceDays,
        nextRunAt,
      },
    });

    await this.audit.record({
      caseId,
      actorId: actor.id,
      actorType: 'user',
      action: 'recurring_schedule.created',
      metadata: { scheduleId: schedule.id, cadenceDays },
    });

    return schedule;
  }

  async setActive(actor: AuthenticatedUser, caseId: string, active: boolean) {
    const schedule = await this.prisma.recurringSchedule.findUnique({ where: { originCaseId: caseId } });
    if (!schedule) throw new NotFoundException('No recurring schedule on this case');

    const updated = await this.prisma.recurringSchedule.update({
      where: { id: schedule.id },
      data: {
        active,
        // Reactivating resets the clock from now, not from whenever it was cancelled.
        nextRunAt: active ? new Date(Date.now() + schedule.cadenceDays * 24 * 60 * 60 * 1000) : schedule.nextRunAt,
      },
    });

    await this.audit.record({
      caseId,
      actorId: actor.id,
      actorType: 'user',
      action: active ? 'recurring_schedule.reactivated' : 'recurring_schedule.cancelled',
      metadata: { scheduleId: schedule.id },
    });

    return updated;
  }

  /** Cron entry point (RecurringSchedulerService) and the manual admin trigger. */
  async processDueSchedules(): Promise<{ processed: number }> {
    const due = await this.prisma.recurringSchedule.findMany({
      where: { active: true, nextRunAt: { lte: new Date() } },
      include: { customer: true },
    });

    for (const schedule of due) {
      const newCase = await this.casesService.spawnCaseFromSchedule(schedule);
      await this.prisma.recurringSchedule.update({
        where: { id: schedule.id },
        data: { nextRunAt: new Date(Date.now() + schedule.cadenceDays * 24 * 60 * 60 * 1000) },
      });
      await this.notifications.notify(
        schedule.customer.userId,
        'A new recurring visit has been scheduled',
        `${newCase.caseNumber} was created automatically as part of your recurring service — we'll take it from here.`,
      );
      this.logger.log(`Spawned ${newCase.caseNumber} from recurring schedule ${schedule.id}`);
    }

    return { processed: due.length };
  }
}

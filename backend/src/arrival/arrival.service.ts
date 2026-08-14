import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ServiceType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { UpsertArrivalProfileDto } from './dto/upsert-arrival-profile.dto';

/**
 * Phase 2 "ASOJU Arrival" (Master PRD v2.0 §6.4). Same access model as
 * DocumentsService: CaseAccessGuard (at the controller) already proves the
 * actor holds real access to this case — customer, assigned agent/
 * provider, or attached staff — so anyone who gets past it may read or
 * amend the Arrival Profile, matching the spec's "customer fills in at
 * intake, staff can amend" description. Case-content authorization is
 * CaseAccessGuard's job, not this service's.
 */
@Injectable()
export class ArrivalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async requireArrivalCase(caseId: string) {
    const serviceCase = await this.prisma.serviceCase.findUnique({ where: { id: caseId } });
    if (!serviceCase) throw new NotFoundException('Case not found');
    if (serviceCase.serviceType !== ServiceType.ARRIVAL_SUPPORT) {
      throw new BadRequestException('This case is not an ASOJU Arrival case');
    }
    return serviceCase;
  }

  async getProfile(caseId: string) {
    await this.requireArrivalCase(caseId);
    return this.prisma.arrivalProfile.findUnique({ where: { caseId } });
  }

  async upsertProfile(actor: AuthenticatedUser, caseId: string, dto: UpsertArrivalProfileDto) {
    await this.requireArrivalCase(caseId);

    const data = {
      arrivalDate: dto.arrivalDate ? new Date(dto.arrivalDate) : undefined,
      flightNumber: dto.flightNumber,
      departureAirport: dto.departureAirport,
      arrivalAirport: dto.arrivalAirport,
      accommodationAddress: dto.accommodationAddress,
      accommodationType: dto.accommodationType,
      numberOfTravelers: dto.numberOfTravelers,
      pickupRequired: dto.pickupRequired,
      groceriesRequired: dto.groceriesRequired,
      specialRequests: dto.specialRequests,
    };

    const profile = await this.prisma.arrivalProfile.upsert({
      where: { caseId },
      create: { caseId, ...data },
      update: data,
    });

    await this.audit.record({
      caseId,
      actorId: actor.id,
      actorType: 'user',
      action: 'arrival_profile.upserted',
      metadata: { profileId: profile.id },
    });

    return profile;
  }
}

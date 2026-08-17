import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PricingZone } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ScopeService } from '../scope/scope.service';
import { usdToNgnRate } from '../concierge/membership-plans';
import { CreatePriceBookDto } from './dto/create-price-book.dto';
import { CreatePriceRuleDto } from './dto/create-price-rule.dto';
import { CreateMultiplierRuleDto } from './dto/create-multiplier-rule.dto';

/// docs/AUTOMATION_PRICING_ENGINE_SCOPE.md Track A / Phase 1 — the
/// deterministic pricing engine. Migrates the one real, already-approved
/// pricing decision in this codebase (regional-pricing.ts's BASE_RATE_USD
/// + URGENCY_MULTIPLIER, from the Platform Expansion PRD) from hardcoded
/// TypeScript into admin-configurable data, and adds the traceability
/// (Quote.priceBookId) the source spec requires: "historical quotes must
/// remain reproducible."
///
/// This is additive, not a replacement — CommerceService.createQuote still
/// accepts fully staff-typed lines exactly as before. `calculateServiceFeeLine`
/// is a new preview a staff member calls first; they still submit the
/// result (or their own numbers) through the existing endpoint.
/// regional-pricing.ts's getRegionalPricingHint is untouched too — this
/// engine is the authoritative successor, not a replacement made in the
/// same pass as this one.
@Injectable()
export class PricingEngineService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
  ) {}

  async createPriceBook(dto: CreatePriceBookDto) {
    return this.prisma.priceBook.create({
      data: { currency: dto.currency ?? 'USD' },
    });
  }

  async listPriceBooks() {
    return this.prisma.priceBook.findMany({ orderBy: { version: 'desc' } });
  }

  /// Only one PriceBook is ever active — matches CaseScope's "exactly one
  /// current version" pattern. Existing quotes keep the priceBookId they
  /// were actually calculated against regardless of what's active later
  /// (Quote.priceBookId has no cascade-on-deactivate behavior — it's just
  /// a plain reference).
  async activatePriceBook(id: string) {
    const book = await this.prisma.priceBook.findUnique({ where: { id } });
    if (!book) throw new NotFoundException('Price book not found');

    await this.prisma.$transaction([
      this.prisma.priceBook.updateMany({ where: { active: true }, data: { active: false } }),
      this.prisma.priceBook.update({ where: { id }, data: { active: true } }),
    ]);
    return this.prisma.priceBook.findUniqueOrThrow({ where: { id } });
  }

  async addPriceRule(priceBookId: string, dto: CreatePriceRuleDto) {
    await this.requirePriceBook(priceBookId);
    return this.prisma.priceRule.create({
      data: {
        priceBookId,
        serviceType: dto.serviceType,
        zone: dto.zone,
        value: dto.value,
        label: dto.label,
        priority: dto.priority ?? 0,
      },
    });
  }

  async listPriceRules(priceBookId: string) {
    await this.requirePriceBook(priceBookId);
    return this.prisma.priceRule.findMany({
      where: { priceBookId },
      orderBy: [{ serviceType: 'asc' }, { zone: 'asc' }, { priority: 'desc' }],
    });
  }

  async addMultiplierRule(priceBookId: string, dto: CreateMultiplierRuleDto) {
    await this.requirePriceBook(priceBookId);
    return this.prisma.multiplierRule.create({
      data: {
        priceBookId,
        type: dto.type,
        casePriority: dto.casePriority,
        multiplier: dto.multiplier,
      },
    });
  }

  async listMultiplierRules(priceBookId: string) {
    await this.requirePriceBook(priceBookId);
    return this.prisma.multiplierRule.findMany({ where: { priceBookId } });
  }

  private async requirePriceBook(priceBookId: string) {
    const book = await this.prisma.priceBook.findUnique({ where: { id: priceBookId } });
    if (!book) throw new NotFoundException('Price book not found');
    return book;
  }

  /// The resolution engine. Returns a discriminated result rather than
  /// throwing for "no price configured" — that's an expected, common
  /// outcome (PricingZone.OTHER, or a service/zone combination nobody has
  /// priced yet), not a server error, and mirrors getRegionalPricingHint's
  /// existing "return null rather than a made-up number" contract. Real
  /// errors (case/scope missing or unconfirmed) still throw, matching
  /// CommerceService.createQuote's own validation for the same conditions.
  async calculateServiceFeeLine(caseId: string): Promise<PricingResult> {
    const serviceCase = await this.prisma.serviceCase.findUnique({
      where: { id: caseId },
      select: { serviceType: true, priority: true },
    });
    if (!serviceCase) throw new NotFoundException('Case not found');

    const latestScope = await this.scope.getLatest(caseId);
    if (!latestScope) {
      throw new BadRequestException('This case has no scope yet — create one before calculating a price');
    }
    if (!latestScope.confirmedAt) {
      throw new BadRequestException('The customer has not confirmed the current scope yet — cannot price until they do');
    }

    const activeBook = await this.prisma.priceBook.findFirst({ where: { active: true } });
    if (!activeBook) {
      return { ok: false, reason: 'No active price book is configured.' };
    }

    if (latestScope.zone === PricingZone.OTHER) {
      return {
        ok: false,
        reason: 'This case is in an unpriced zone ("Other Locations") — set the service fee manually.',
      };
    }

    const rule = await this.prisma.priceRule.findFirst({
      where: {
        priceBookId: activeBook.id,
        serviceType: serviceCase.serviceType,
        zone: latestScope.zone,
        active: true,
      },
      orderBy: { priority: 'desc' },
    });
    if (!rule) {
      return {
        ok: false,
        reason: `No price is configured for ${serviceCase.serviceType} in ${latestScope.zone}.`,
      };
    }

    const multiplierRule = await this.prisma.multiplierRule.findFirst({
      where: {
        priceBookId: activeBook.id,
        type: 'URGENCY',
        casePriority: serviceCase.priority,
        active: true,
      },
    });

    const multiplier = multiplierRule ? Number(multiplierRule.multiplier) : 1;
    const amountUsd = Math.round(Number(rule.value) * multiplier * 100) / 100;
    const fxRate = usdToNgnRate();
    const amountNgn = Math.round(amountUsd * fxRate);

    return {
      ok: true,
      priceBookId: activeBook.id,
      priceRuleId: rule.id,
      zone: latestScope.zone,
      label: rule.label,
      amountUsd,
      fxRate,
      amountNgn,
      multiplierApplied: multiplier !== 1,
    };
  }
}

export type PricingResult =
  | {
      ok: true;
      priceBookId: string;
      priceRuleId: string;
      zone: PricingZone;
      label: string;
      amountUsd: number;
      fxRate: number;
      amountNgn: number;
      multiplierApplied: boolean;
    }
  | { ok: false; reason: string };

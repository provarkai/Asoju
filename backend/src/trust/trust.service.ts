import { Injectable } from '@nestjs/common';
import { CaseStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

// Cap on how many testimonials the public page ever returns — plenty for
// a trust page, and keeps the unauthenticated response bounded regardless
// of how many customers eventually opt in.
const MAX_TESTIMONIALS = 20;

/**
 * Public trust/social-proof page (strategic-suggestions pass, Tier 3
 * "cheapest, safest quick win on this whole list") — every number and
 * quote here traces back to a real `Rating` row, never invented. Both the
 * average rating and every testimonial are sourced *only* from ratings
 * with `publicConsent: true` (opt-in, off by default) — a customer who
 * never checked the box contributes to nothing on this page, not even
 * anonymized. `casesCompleted` is the one exception: a platform-wide
 * count with no link to any individual customer's rating or consent at
 * all, so it's safe to show unconditionally.
 */
@Injectable()
export class TrustService {
  constructor(private readonly prisma: PrismaService) {}

  async getPublicStats() {
    const [casesCompleted, consented] = await Promise.all([
      this.prisma.serviceCase.count({
        where: { status: { in: [CaseStatus.COMPLETED, CaseStatus.CLOSED] } },
      }),
      this.prisma.rating.findMany({
        where: { publicConsent: true },
        select: {
          stars: true,
          comment: true,
          createdAt: true,
          case: { select: { serviceType: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const averageRating = consented.length
      ? consented.reduce((sum, r) => sum + r.stars, 0) / consented.length
      : null;

    // Never a name, case number, or anything else identifying — stars,
    // the comment itself, which service it was, and when.
    const testimonials = consented
      .filter((r) => r.comment && r.comment.trim().length > 0)
      .slice(0, MAX_TESTIMONIALS)
      .map((r) => ({
        stars: r.stars,
        comment: r.comment,
        serviceType: r.case.serviceType,
        createdAt: r.createdAt,
      }));

    return {
      casesCompleted,
      averageRating,
      consentedRatingCount: consented.length,
      testimonials,
    };
  }
}

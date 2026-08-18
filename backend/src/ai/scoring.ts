import { LeadTag } from '@prisma/client';

export type Timeline = 'immediate' | 'near_term' | 'exploring';

export interface ScoringInput {
  statedValue: number | null;
  servicePriceBand: number;
  timeline: Timeline | null;
  /** LLM-assessed 0-15 sub-score for conversational engagement quality. */
  engagementSubscore: number;
}

export interface ScoringResult {
  score: number;
  tag: LeadTag;
}

/**
 * Section 7.4 — deterministic scoring, NOT another LLM call. Applied
 * post-conversation once required fields are collected. The LLM only ever
 * supplies `engagementSubscore`; every other point is computed here so the
 * result is auditable and reproducible (Non-Negotiable #8).
 */
export function scoreLead(input: ScoringInput): ScoringResult {
  let score = 0;

  // Budget/value fit (45 pts) — was 35; absorbed the 10pt gap left by
  // dropping the payment-method sub-signal below.
  if (input.statedValue !== null) {
    if (input.statedValue >= input.servicePriceBand) score += 45;
    else if (input.statedValue >= input.servicePriceBand * 0.8) score += 26;
    else score += 6;
  } else {
    score += 6;
  }

  // Urgency/timeline (40 pts) — was 30; absorbed the other 10pts. The AI
  // Concierge no longer asks how the customer intends to pay (never part
  // of the intake conversation — payment happens after sign-in, against
  // a real quote), so "commitment signal" is no longer a collectible
  // sub-signal here at all, rather than left in place scoring null/null.
  if (input.timeline === 'immediate') score += 40;
  else if (input.timeline === 'near_term') score += 24;
  else score += 7;

  // Engagement quality (15 pts) — LLM-assessed 0-15 sub-score
  const engagement = Math.max(0, Math.min(15, Math.round(input.engagementSubscore)));
  score += engagement;

  let tag: LeadTag;
  if (score >= 75) tag = LeadTag.HOT;
  else if (score >= 45) tag = LeadTag.WARM;
  else tag = LeadTag.COLD;

  return { score, tag };
}

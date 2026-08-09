import { LeadTag } from '@prisma/client';

export type Timeline = 'immediate' | 'near_term' | 'exploring';
export type PaymentMethod = 'cash_ready' | 'diaspora_plan' | 'financing';

export interface ScoringInput {
  statedValue: number | null;
  servicePriceBand: number;
  timeline: Timeline | null;
  paymentMethod: PaymentMethod | null;
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

  // Budget/value fit (35 pts)
  if (input.statedValue !== null) {
    if (input.statedValue >= input.servicePriceBand) score += 35;
    else if (input.statedValue >= input.servicePriceBand * 0.8) score += 20;
    else score += 5;
  } else {
    score += 5;
  }

  // Urgency/timeline (30 pts)
  if (input.timeline === 'immediate') score += 30;
  else if (input.timeline === 'near_term') score += 18;
  else score += 5;

  // Commitment signal — financing/payment method (20 pts)
  if (input.paymentMethod === 'cash_ready') score += 20;
  else if (input.paymentMethod === 'diaspora_plan') score += 14;
  else score += 8;

  // Engagement quality (15 pts) — LLM-assessed 0-15 sub-score
  const engagement = Math.max(0, Math.min(15, Math.round(input.engagementSubscore)));
  score += engagement;

  let tag: LeadTag;
  if (score >= 75) tag = LeadTag.HOT;
  else if (score >= 45) tag = LeadTag.WARM;
  else tag = LeadTag.COLD;

  return { score, tag };
}

import { AutomationDecisionOutcome, AutomationRuleKind, ServiceType } from '@prisma/client';

/**
 * docs/AUTOMATION_PRICING_ENGINE_SCOPE.md Phase 3 — the deterministic
 * rule-evaluation service, pure and DB-free so it's trivially unit-testable
 * (same "pure calculation, deterministic inputs/outputs" reasoning Phase 1's
 * scope gave for building the pricing calculator in isolation). Non-Negotiable
 * carried forward from the source spec: this is code, never an AI judgment
 * call — same philosophy as CaseStatus's state machine and RiskEngineService.
 */

export interface EvaluableRequest {
  serviceType: ServiceType | null;
  objective: string | null;
  location: string | null;
  timing: string | null;
  rawDescription: string;
}

export interface EvaluableCapability {
  enabled: boolean;
  rules: { id: string; kind: AutomationRuleKind; config: unknown }[];
}

export interface RuleResult {
  ruleId: string;
  kind: AutomationRuleKind;
  passed: boolean;
  detail?: string;
}

export interface EvaluationResult {
  outcome: AutomationDecisionOutcome;
  reason: string;
  ruleResults: RuleResult[];
  capabilityEnabled: boolean;
}

const FIELD_ACCESSORS: Record<string, (r: EvaluableRequest) => string | null> = {
  serviceType: (r) => r.serviceType,
  objective: (r) => r.objective,
  location: (r) => r.location,
  timing: (r) => r.timing,
};

function evaluateRequiredFields(request: EvaluableRequest, ruleId: string, config: unknown): RuleResult {
  const fields = Array.isArray((config as { fields?: unknown })?.fields) ? ((config as { fields: string[] }).fields) : [];
  const missing = fields.filter((f) => {
    const accessor = FIELD_ACCESSORS[f];
    const value = accessor ? accessor(request) : null;
    return !value || !value.trim();
  });
  return {
    ruleId,
    kind: AutomationRuleKind.REQUIRED_FIELDS,
    passed: missing.length === 0,
    detail: missing.length ? `Missing: ${missing.join(', ')}` : undefined,
  };
}

function evaluateBlockedKeywords(request: EvaluableRequest, ruleId: string, config: unknown): RuleResult {
  const keywords = Array.isArray((config as { keywords?: unknown })?.keywords) ? ((config as { keywords: string[] }).keywords) : [];
  const haystack = `${request.rawDescription} ${request.objective ?? ''}`.toLowerCase();
  const matched = keywords.find((k) => haystack.includes(k.toLowerCase()));
  return {
    ruleId,
    kind: AutomationRuleKind.BLOCKED_KEYWORDS,
    passed: !matched,
    detail: matched ? `Matched blocked keyword: ${matched}` : undefined,
  };
}

/** Pure decision function — no I/O, no randomness, no clock. Same
 * (request, capability) always produces the same result. */
export function evaluate(request: EvaluableRequest, capability: EvaluableCapability | null): EvaluationResult {
  if (!request.serviceType) {
    return {
      outcome: AutomationDecisionOutcome.CUSTOMER_INPUT,
      reason: 'Service type has not been determined yet',
      ruleResults: [],
      capabilityEnabled: false,
    };
  }

  if (!capability) {
    return {
      outcome: AutomationDecisionOutcome.UNSUPPORTED,
      reason: `Automation is not offered for ${request.serviceType} yet`,
      ruleResults: [],
      capabilityEnabled: false,
    };
  }

  if (!capability.enabled) {
    return {
      outcome: AutomationDecisionOutcome.ESCALATE,
      reason: `Automation is currently disabled for ${request.serviceType}`,
      ruleResults: [],
      capabilityEnabled: false,
    };
  }

  const ruleResults = capability.rules.map((rule) =>
    rule.kind === AutomationRuleKind.BLOCKED_KEYWORDS
      ? evaluateBlockedKeywords(request, rule.id, rule.config)
      : evaluateRequiredFields(request, rule.id, rule.config),
  );

  // Precedence: a blocked request is blocked regardless of what other
  // information it's missing (source spec — never bypass a configured
  // block). Required-fields failures come next; only if everything
  // required is present and nothing is blocked does this reach AUTO.
  const blocked = ruleResults.find((r) => r.kind === AutomationRuleKind.BLOCKED_KEYWORDS && !r.passed);
  if (blocked) {
    return {
      outcome: AutomationDecisionOutcome.BLOCKED,
      reason: blocked.detail ?? 'A blocked-keyword rule matched',
      ruleResults,
      capabilityEnabled: true,
    };
  }

  const missingFields = ruleResults.find((r) => r.kind === AutomationRuleKind.REQUIRED_FIELDS && !r.passed);
  if (missingFields) {
    return {
      outcome: AutomationDecisionOutcome.CUSTOMER_INPUT,
      reason: missingFields.detail ?? 'Required information is missing',
      ruleResults,
      capabilityEnabled: true,
    };
  }

  return {
    outcome: AutomationDecisionOutcome.AUTO,
    reason: 'Every configured rule passed',
    ruleResults,
    capabilityEnabled: true,
  };
}

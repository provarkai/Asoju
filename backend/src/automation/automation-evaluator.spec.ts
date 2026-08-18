import { AutomationDecisionOutcome, AutomationRuleKind, ServiceType } from '@prisma/client';
import { EvaluableCapability, EvaluableRequest, evaluate } from './automation-evaluator';

const BASE_REQUEST: EvaluableRequest = {
  serviceType: ServiceType.PROCUREMENT,
  objective: 'Buy a generator',
  location: 'Lagos',
  timing: 'Next week',
  rawDescription: 'I need a generator sourced and delivered',
};

const REQUIRED_FIELDS_CAPABILITY: EvaluableCapability = {
  enabled: true,
  rules: [{ id: 'r1', kind: AutomationRuleKind.REQUIRED_FIELDS, config: { fields: ['objective', 'location', 'timing'] } }],
};

describe('AutomationEligibilityService evaluator (pure, no I/O)', () => {
  it('CUSTOMER_INPUT when serviceType is not yet known, before any capability lookup', () => {
    const result = evaluate({ ...BASE_REQUEST, serviceType: null }, REQUIRED_FIELDS_CAPABILITY);
    expect(result.outcome).toBe(AutomationDecisionOutcome.CUSTOMER_INPUT);
    expect(result.capabilityEnabled).toBe(false);
    expect(result.ruleResults).toHaveLength(0);
  });

  it('UNSUPPORTED when no AutomationCapability exists for the service type at all', () => {
    const result = evaluate(BASE_REQUEST, null);
    expect(result.outcome).toBe(AutomationDecisionOutcome.UNSUPPORTED);
    expect(result.capabilityEnabled).toBe(false);
  });

  it('ESCALATE when the capability exists but its kill switch is off', () => {
    const result = evaluate(BASE_REQUEST, { enabled: false, rules: [] });
    expect(result.outcome).toBe(AutomationDecisionOutcome.ESCALATE);
    expect(result.capabilityEnabled).toBe(false);
  });

  it('AUTO when the capability is enabled and every rule passes', () => {
    const result = evaluate(BASE_REQUEST, REQUIRED_FIELDS_CAPABILITY);
    expect(result.outcome).toBe(AutomationDecisionOutcome.AUTO);
    expect(result.capabilityEnabled).toBe(true);
    expect(result.ruleResults).toEqual([{ ruleId: 'r1', kind: AutomationRuleKind.REQUIRED_FIELDS, passed: true, detail: undefined }]);
  });

  it('CUSTOMER_INPUT when a required field is missing, naming exactly which one', () => {
    const result = evaluate({ ...BASE_REQUEST, timing: null }, REQUIRED_FIELDS_CAPABILITY);
    expect(result.outcome).toBe(AutomationDecisionOutcome.CUSTOMER_INPUT);
    expect(result.reason).toContain('timing');
    expect(result.capabilityEnabled).toBe(true);
  });

  it('CUSTOMER_INPUT when a required field is present but blank/whitespace-only', () => {
    const result = evaluate({ ...BASE_REQUEST, objective: '   ' }, REQUIRED_FIELDS_CAPABILITY);
    expect(result.outcome).toBe(AutomationDecisionOutcome.CUSTOMER_INPUT);
    expect(result.reason).toContain('objective');
  });

  it('BLOCKED when a blocked-keyword rule matches, even if required fields are also missing', () => {
    const capability: EvaluableCapability = {
      enabled: true,
      rules: [
        { id: 'r1', kind: AutomationRuleKind.BLOCKED_KEYWORDS, config: { keywords: ['firearm', 'weapon'] } },
        { id: 'r2', kind: AutomationRuleKind.REQUIRED_FIELDS, config: { fields: ['objective', 'location', 'timing'] } },
      ],
    };
    const result = evaluate({ ...BASE_REQUEST, timing: null, rawDescription: 'Source a legal firearm for my father' }, capability);
    expect(result.outcome).toBe(AutomationDecisionOutcome.BLOCKED);
    expect(result.reason).toContain('firearm');
  });

  it('blocked-keyword matching is case-insensitive and checks the objective field too', () => {
    const capability: EvaluableCapability = {
      enabled: true,
      rules: [{ id: 'r1', kind: AutomationRuleKind.BLOCKED_KEYWORDS, config: { keywords: ['weapon'] } }],
    };
    const result = evaluate({ ...BASE_REQUEST, objective: 'Buy a WEAPON', rawDescription: 'unrelated text' }, capability);
    expect(result.outcome).toBe(AutomationDecisionOutcome.BLOCKED);
  });

  it('never crosses into AUTO with a missing serviceType, regardless of how permissive the capability is', () => {
    const permissive: EvaluableCapability = { enabled: true, rules: [] };
    const result = evaluate({ ...BASE_REQUEST, serviceType: null }, permissive);
    expect(result.outcome).not.toBe(AutomationDecisionOutcome.AUTO);
  });

  it('a capability with zero rules and enabled=true is AUTO — no rules means nothing to fail', () => {
    const result = evaluate(BASE_REQUEST, { enabled: true, rules: [] });
    expect(result.outcome).toBe(AutomationDecisionOutcome.AUTO);
  });
});

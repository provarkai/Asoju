// ═══════════════════════════════════════════════════════════════════════════════
// Circuit Breaker — Production Reliability
// ═══════════════════════════════════════════════════════════════════════════════
// Ported from fieldforce/src/lib/circuit-breaker.ts (its "P0.10 Production
// Reliability" pattern) — confirmed absent from this backend before now
// (no circuit-breaker anywhere in src/), while every outbound integration
// here (WhatsappSenderService/EmailService/PaystackService) calls out to a
// third-party API with no protection against that provider degrading. A
// provider going slow/erroring doesn't just fail its own calls today — it
// slows down every request on the path that happens to notify/charge
// through it, with no backoff, for as long as the outage lasts.
//
// States: CLOSED (normal) → OPEN (failing, calls rejected immediately) →
// HALF_OPEN (cooldown elapsed, a single test call decides CLOSED vs OPEN).
//
// One behavioural change from the FieldForce version: there, breakers live
// in a static-by-name registry because Next.js route handlers don't share
// a long-lived DI container the way a Nest app's singleton services do.
// Here each service just holds its own breaker as an instance field —
// simpler, and it means a fresh `new WhatsappSenderService()` in a unit
// test gets a fresh breaker with no cross-test state to reset. The static
// registry is kept, but purely opt-in (register()), for an ops/health
// endpoint that wants to see every breaker's state at once.
//
// Usage:
//   private readonly breaker = new CircuitBreaker({ name: 'zavu', failureThreshold: 3 });
//   await this.breaker.execute(() => fetch(...));
// ═══════════════════════════════════════════════════════════════════════════════

import { Logger } from '@nestjs/common';

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerConfig {
  name: string;
  failureThreshold?: number; // Failures before opening (default: 5)
  resetTimeoutMs?: number; // Time before trying half-open (default: 30s)
  halfOpenMaxCalls?: number; // Test calls allowed in half-open (default: 1)
  timeoutMs?: number; // Per-call timeout (default: 10s)
}

export interface CircuitBreakerStats {
  state: CircuitState;
  failures: number;
  successes: number;
  totalCalls: number;
  lastFailureAt: Date | null;
  lastSuccessAt: Date | null;
  openedAt: Date | null;
  halfOpenAttempts: number;
}

export class CircuitBreakerError extends Error {
  public readonly stats: CircuitBreakerStats;

  constructor(message: string, stats: CircuitBreakerStats) {
    super(message);
    this.name = 'CircuitBreakerError';
    this.stats = stats;
  }
}

export class CircuitBreaker {
  private readonly logger = new Logger(`CircuitBreaker:${this.config.name}`);

  private state: CircuitState = 'CLOSED';
  private failures = 0;
  private successes = 0;
  private totalCalls = 0;
  private lastFailureAt: Date | null = null;
  private lastSuccessAt: Date | null = null;
  private openedAt: Date | null = null;
  private halfOpenAttempts = 0;

  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;
  private readonly halfOpenMaxCalls: number;
  private readonly timeoutMs: number;

  private static readonly registry = new Map<string, CircuitBreaker>();

  constructor(private readonly config: CircuitBreakerConfig) {
    this.failureThreshold = config.failureThreshold ?? 5;
    this.resetTimeoutMs = config.resetTimeoutMs ?? 30_000;
    this.halfOpenMaxCalls = config.halfOpenMaxCalls ?? 1;
    this.timeoutMs = config.timeoutMs ?? 10_000;
  }

  /** Opt-in registration for introspection (e.g. an ops health endpoint
   * listing every breaker's state). Keyed by name — a later registration
   * under the same name (a fresh instance) replaces the earlier one,
   * which is exactly what a test recreating a service should do. */
  static register(breaker: CircuitBreaker): CircuitBreaker {
    CircuitBreaker.registry.set(breaker.config.name, breaker);
    return breaker;
  }

  static getAllStats(): Record<string, CircuitBreakerStats> {
    const stats: Record<string, CircuitBreakerStats> = {};
    for (const [name, breaker] of CircuitBreaker.registry) {
      stats[name] = breaker.getStats();
    }
    return stats;
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    this.totalCalls++;

    if (this.state === 'OPEN') {
      if (this.openedAt && Date.now() - this.openedAt.getTime() >= this.resetTimeoutMs) {
        this.transitionTo('HALF_OPEN');
      } else {
        throw new CircuitBreakerError(`Circuit "${this.config.name}" is OPEN — call rejected`, this.getStats());
      }
    }

    if (this.state === 'HALF_OPEN') {
      if (this.halfOpenAttempts >= this.halfOpenMaxCalls) {
        throw new CircuitBreakerError(
          `Circuit "${this.config.name}" is HALF_OPEN — max test calls reached`,
          this.getStats(),
        );
      }
      this.halfOpenAttempts++;
    }

    try {
      const result = await this.withTimeout(fn(), this.timeoutMs);
      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }

  private recordSuccess(): void {
    this.successes++;
    this.lastSuccessAt = new Date();

    if (this.state === 'HALF_OPEN') {
      this.transitionTo('CLOSED');
      this.failures = 0;
      this.halfOpenAttempts = 0;
    }
  }

  private recordFailure(): void {
    this.failures++;
    this.lastFailureAt = new Date();

    if (this.state === 'HALF_OPEN') {
      this.transitionTo('OPEN');
      this.halfOpenAttempts = 0;
    } else if (this.state === 'CLOSED' && this.failures >= this.failureThreshold) {
      this.transitionTo('OPEN');
    }
  }

  private transitionTo(newState: CircuitState): void {
    const oldState = this.state;
    this.state = newState;
    if (newState === 'OPEN') this.openedAt = new Date();
    this.logger.warn(`State: ${oldState} → ${newState} (failures: ${this.failures}, total: ${this.totalCalls})`);
  }

  private withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs)),
    ]);
  }

  getStats(): CircuitBreakerStats {
    return {
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      totalCalls: this.totalCalls,
      lastFailureAt: this.lastFailureAt,
      lastSuccessAt: this.lastSuccessAt,
      openedAt: this.openedAt,
      halfOpenAttempts: this.halfOpenAttempts,
    };
  }

  reset(): void {
    this.state = 'CLOSED';
    this.failures = 0;
    this.successes = 0;
    this.totalCalls = 0;
    this.openedAt = null;
    this.halfOpenAttempts = 0;
  }
}

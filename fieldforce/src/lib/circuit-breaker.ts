// ═══════════════════════════════════════════════════════════════════════════════
// P0.10 PRODUCTION RELIABILITY — Circuit Breaker Pattern
// ═══════════════════════════════════════════════════════════════════════════════
//
// Protects external service calls (Paystack, ASOJU, etc.) from cascading
// failures. When failures exceed a threshold, the circuit opens and
// short-circuits further calls for a cooldown period.
//
// States: CLOSED (normal) → OPEN (failing) → HALF_OPEN (testing recovery)
//
// Usage:
//   const breaker = CircuitBreaker.create({
//     name: 'paystack',
//     failureThreshold: 3,
//     resetTimeoutMs: 30_000,
//   });
//   const result = await breaker.execute(() => paystackApi.transfer(...));
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Circuit State ──────────────────────────────────────────────────────────

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN'

// ─── Circuit Breaker Config ────────────────────────────────────────────────

export interface CircuitBreakerConfig {
  name: string
  failureThreshold?: number   // Failures before opening (default: 5)
  resetTimeoutMs?: number    // Time before trying half-open (default: 30s)
  halfOpenMaxCalls?: number  // Test calls in half-open (default: 1)
  timeoutMs?: number         // Per-call timeout (default: 10s)
  monitorIntervalMs?: number // Stats reset interval (default: 60s)
  onStateChange?: (state: CircuitState) => void
}

// ─── Circuit Breaker Stats ─────────────────────────────────────────────────

export interface CircuitBreakerStats {
  state: CircuitState
  failures: number
  successes: number
  totalCalls: number
  lastFailureAt: Date | null
  lastSuccessAt: Date | null
  openedAt: Date | null
  halfOpenAttempts: number
}

// ─── Circuit Breaker Implementation ──────────────────────────────────────────

export class CircuitBreaker {
  private name: string
  private state: CircuitState = 'CLOSED'
  private failures: number = 0
  private successes: number = 0
  private totalCalls: number = 0
  private lastFailureAt: Date | null = null
  private lastSuccessAt: Date | null = null
  private openedAt: Date | null = null
  private halfOpenAttempts: number = 0

  private readonly failureThreshold: number
  private readonly resetTimeoutMs: number
  private readonly halfOpenMaxCalls: number
  private readonly timeoutMs: number
  private readonly monitorIntervalMs: number
  private readonly onStateChange?: (state: CircuitState) => void

  // In-memory registry of all breakers
  private static registry: Map<string, CircuitBreaker> = new Map()

  private constructor(config: CircuitBreakerConfig) {
    this.name = config.name
    this.failureThreshold = config.failureThreshold ?? 5
    this.resetTimeoutMs = config.resetTimeoutMs ?? 30_000
    this.halfOpenMaxCalls = config.halfOpenMaxCalls ?? 1
    this.timeoutMs = config.timeoutMs ?? 10_000
    this.monitorIntervalMs = config.monitorIntervalMs ?? 60_000
    this.onStateChange = config.onStateChange
  }

  // ─── Factory ────────────────────────────────────────────────────────────

  static create(config: CircuitBreakerConfig): CircuitBreaker {
    const existing = CircuitBreaker.registry.get(config.name)
    if (existing) return existing

    const breaker = new CircuitBreaker(config)
    CircuitBreaker.registry.set(config.name, breaker)
    return breaker
  }

  static get(name: string): CircuitBreaker | undefined {
    return CircuitBreaker.registry.get(name)
  }

  static getAllStats(): Record<string, CircuitBreakerStats> {
    const stats: Record<string, CircuitBreakerStats> = {}
    for (const [name, breaker] of CircuitBreaker.registry) {
      stats[name] = breaker.getStats()
    }
    return stats
  }

  // ─── Execute with Protection ──────────────────────────────────────────────

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    this.totalCalls++

    // If OPEN, check if reset timeout has passed
    if (this.state === 'OPEN') {
      if (this.openedAt && Date.now() - this.openedAt.getTime() >= this.resetTimeoutMs) {
        this.transitionTo('HALF_OPEN')
      } else {
        throw new CircuitBreakerError(
          `Circuit "${this.name}" is OPEN — call rejected`,
          this.getStats()
        )
      }
    }

    // If HALF_OPEN, limit concurrent test calls
    if (this.state === 'HALF_OPEN') {
      if (this.halfOpenAttempts >= this.halfOpenMaxCalls) {
        throw new CircuitBreakerError(
          `Circuit "${this.name}" is HALF_OPEN — max test calls reached`,
          this.getStats()
        )
      }
      this.halfOpenAttempts++
    }

    try {
      // Apply timeout wrapper
      const result = await this.withTimeout(fn(), this.timeoutMs)
      this.recordSuccess()
      return result
    } catch (error) {
      this.recordFailure(error instanceof Error ? error.message : 'Unknown error')
      throw error
    }
  }

  // ─── State Transitions ───────────────────────────────────────────────────

  private recordSuccess(): void {
    this.successes++
    this.lastSuccessAt = new Date()

    if (this.state === 'HALF_OPEN') {
      // Recovery confirmed → close the circuit
      this.transitionTo('CLOSED')
      this.failures = 0
      this.halfOpenAttempts = 0
    }
  }

  private recordFailure(error: string): void {
    this.failures++
    this.lastFailureAt = new Date()

    if (this.state === 'HALF_OPEN') {
      // Recovery failed → back to OPEN
      this.transitionTo('OPEN')
      this.halfOpenAttempts = 0
    } else if (this.state === 'CLOSED' && this.failures >= this.failureThreshold) {
      // Threshold exceeded → open the circuit
      this.transitionTo('OPEN')
    }
  }

  private transitionTo(newState: CircuitState): void {
    const oldState = this.state
    this.state = newState

    if (newState === 'OPEN') {
      this.openedAt = new Date()
    }

    this.onStateChange?.(newState)
    console.warn(
      `[CircuitBreaker:${this.name}] State: ${oldState} → ${newState} ` +
      `(failures: ${this.failures}, total: ${this.totalCalls})`
    )
  }

  // ─── Timeout Wrapper ─────────────────────────────────────────────────────

  private withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs)
      ),
    ])
  }

  // ─── Stats ────────────────────────────────────────────────────────────────

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
    }
  }

  // ─── Manual Reset ────────────────────────────────────────────────────────

  reset(): void {
    this.state = 'CLOSED'
    this.failures = 0
    this.successes = 0
    this.totalCalls = 0
    this.openedAt = null
    this.halfOpenAttempts = 0
  }

  // ─── Force State ─────────────────────────────────────────────────────────

  forceState(state: CircuitState): void {
    this.transitionTo(state)
    if (state === 'CLOSED') {
      this.failures = 0
      this.halfOpenAttempts = 0
    }
    if (state === 'OPEN') {
      this.openedAt = new Date()
    }
  }
}

// ─── Circuit Breaker Error ─────────────────────────────────────────────────

export class CircuitBreakerError extends Error {
  public readonly stats: CircuitBreakerStats

  constructor(message: string, stats: CircuitBreakerStats) {
    super(message)
    this.name = 'CircuitBreakerError'
    this.stats = stats
  }
}

// ─── Pre-configured Breakers ───────────────────────────────────────────────

export const paystackBreaker = CircuitBreaker.create({
  name: 'paystack',
  failureThreshold: 3,
  resetTimeoutMs: 30_000,
  timeoutMs: 15_000,
})

export const asojuBreaker = CircuitBreaker.create({
  name: 'asoju-integration',
  failureThreshold: 5,
  resetTimeoutMs: 60_000,
  timeoutMs: 10_000,
})

export const externalStorageBreaker = CircuitBreaker.create({
  name: 'external-storage',
  failureThreshold: 5,
  resetTimeoutMs: 30_000,
  timeoutMs: 30_000,
})

import { Injectable, Logger } from '@nestjs/common';
import { BillingCurrency } from '@prisma/client';
import { CircuitBreaker, CircuitBreakerError } from '../common/resilience/circuit-breaker';

const FRANKFURTER_URL = 'https://api.frankfurter.dev/v1/latest?base=USD&symbols=GBP,EUR';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

interface FrankfurterResponse {
  rates: Record<string, number>;
}

interface CachedRates {
  rates: Record<'GBP' | 'EUR', number>;
  fetchedAt: number;
}

/**
 * Live USD -> {GBP,EUR} rate for display purposes only — "converted at the
 * current rate," per the Platform Expansion request. Unlike every other
 * external integration in this repo (Paystack, Zavu, Resend), this needs
 * no account/API key: Frankfurter (frankfurter.dev) is a free, keyless,
 * ECB-reference-rate API — verified live before wiring this up
 * (`curl https://api.frankfurter.dev/v1/latest?base=USD&symbols=GBP,EUR`
 * returned real rates with no auth). So there's no "dry run" mode the way
 * WhatsappSenderService/PaystackService have: an unreachable API here
 * falls back to the last good cached rate (logged, not invented) rather
 * than a synthetic placeholder, and only throws if there has never been a
 * successful fetch.
 *
 * This rate is never locked/stored against a Quote the way
 * `Quote.lockedFxRate` (USD->NGN, the actual payment amount) is — it's
 * recomputed live every time it's shown, exactly because it's informational,
 * never a number anyone is charged.
 */
@Injectable()
export class FxRateService {
  private readonly logger = new Logger(FxRateService.name);
  private cache: CachedRates | null = null;

  private readonly breaker = CircuitBreaker.register(
    new CircuitBreaker({ name: 'frankfurter-fx', failureThreshold: 3, resetTimeoutMs: 30_000, timeoutMs: 10_000 }),
  );

  /** USD -> `to`. USD itself is always 1 and never fetched. */
  async getRate(to: Exclude<BillingCurrency, 'USD'>): Promise<number> {
    if (this.cache && Date.now() - this.cache.fetchedAt < CACHE_TTL_MS) {
      return this.cache.rates[to];
    }

    try {
      const rates = await this.breaker.execute(async () => {
        const res = await fetch(FRANKFURTER_URL);
        if (!res.ok) throw new Error(`Frankfurter request failed: ${res.status}`);
        const body = (await res.json()) as FrankfurterResponse;
        if (typeof body.rates?.GBP !== 'number' || typeof body.rates?.EUR !== 'number') {
          throw new Error('Frankfurter response missing GBP/EUR rates');
        }
        return { GBP: body.rates.GBP, EUR: body.rates.EUR };
      });
      this.cache = { rates, fetchedAt: Date.now() };
      return this.cache.rates[to];
    } catch (error) {
      const reason = error instanceof CircuitBreakerError ? error.message : error instanceof Error ? error.message : 'unknown error';
      if (this.cache) {
        this.logger.warn(`Live FX rate fetch failed (${reason}) — serving last known rate from ${new Date(this.cache.fetchedAt).toISOString()}`);
        return this.cache.rates[to];
      }
      this.logger.error(`Live FX rate fetch failed (${reason}) and no cached rate is available`);
      throw new Error('Exchange rate is temporarily unavailable');
    }
  }
}

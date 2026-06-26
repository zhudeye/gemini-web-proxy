import type { OutgoingHttpHeaders } from 'node:http';

export interface GuardResult {
  readonly allowed: boolean;
  readonly statusCode: number;
  readonly error: string;
  readonly headers: OutgoingHttpHeaders;
}

function guardError(statusCode: number, message: string, retryAfter?: number): GuardResult {
  const headers: OutgoingHttpHeaders = { 'Content-Type': 'application/json; charset=utf-8' };
  if (retryAfter !== undefined) {
    headers['Retry-After'] = String(retryAfter);
  }

  return { allowed: false, statusCode, error: message, headers };
}

const ALLOWED: GuardResult = { allowed: true, statusCode: 200, error: '', headers: {} };

/**
 * Semaphore to limit concurrent requests per API key.
 *
 * Prevents the proxy from sending multiple simultaneous requests to Gemini,
 * which would be a strong automation signal. Max 1-2 concurrent is human-like.
 */
class ConcurrencyLimiter {
  private readonly counts = new Map<string, number>();

  constructor(private readonly max: number) {}

  tryAcquire(key: string): boolean {
    const current = this.counts.get(key) ?? 0;
    if (current >= this.max) {
      return false;
    }

    this.counts.set(key, current + 1);
    return true;
  }

  release(key: string): void {
    const current = this.counts.get(key) ?? 0;
    if (current <= 1) {
      this.counts.delete(key);
    } else {
      this.counts.set(key, current - 1);
    }
  }

  get active(): number {
    let sum = 0;
    for (const count of this.counts.values()) {
      sum += count;
    }

    return sum;
  }
}

/**
 * Track last request timestamp per API key and enforce a minimum interval.
 */
class DelayTracker {
  private readonly lastRequest = new Map<string, number>();

  constructor(private readonly minIntervalMs: number) {}

  tryRequest(key: string, now = Date.now()): boolean {
    const last = this.lastRequest.get(key);
    // First request for this key — always allowed
    if (last === undefined) {
      this.lastRequest.set(key, now);
      return true;
    }

    if (now - last < this.minIntervalMs) {
      return false;
    }

    this.lastRequest.set(key, now);
    return true;
  }

  /** Time in seconds until the key can send another request. */
  retryAfter(key: string, now = Date.now()): number {
    const last = this.lastRequest.get(key);
    if (last === undefined) {
      return 0;
    }

    const elapsed = now - last;
    if (elapsed >= this.minIntervalMs) {
      return 0;
    }

    return Math.ceil((this.minIntervalMs - elapsed) / 1000);
  }
}

/**
 * Daily quota limiter — resets at midnight local time.
 * This prevents runaway usage from burning through your Gemini Web session.
 */
class DailyQuotaLimiter {
  // Map<apiKey, { dateKey: string, count: number }>
  // dateKey = YYYY-MM-DD for simple daily rollover
  private readonly entries = new Map<string, { dateKey: string; count: number }>();

  constructor(private readonly limit: number) {}

  tryConsume(key: string, now = Date.now()): boolean {
    const dateKey = dailyDateKey(now);
    const entry = this.entries.get(key);

    if (entry === undefined || entry.dateKey !== dateKey) {
      this.entries.set(key, { dateKey, count: 1 });
      return true;
    }

    if (entry.count >= this.limit) {
      return false;
    }

    entry.count += 1;
    return true;
  }

  remaining(key: string, now = Date.now()): number {
    const dateKey = dailyDateKey(now);
    const entry = this.entries.get(key);
    if (entry === undefined || entry.dateKey !== dateKey) {
      return this.limit;
    }

    return Math.max(this.limit - entry.count, 0);
  }
}

function dailyDateKey(now: number): string {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Combined request guard: concurrency + delay + daily quota.
 * All checks must pass before a request is allowed to proceed.
 *
 * Call `acquire(key)` before handling a request.
 * Call `release(key)` when the request finishes (success or error).
 */
export class RequestGuard {
  private readonly concurrency: ConcurrencyLimiter;
  private readonly delay: DelayTracker;
  private readonly daily: DailyQuotaLimiter;

  constructor(maxConcurrent: number, minDelayMs: number, dailyQuota: number) {
    this.concurrency = new ConcurrencyLimiter(maxConcurrent);
    this.delay = new DelayTracker(minDelayMs);
    this.daily = new DailyQuotaLimiter(dailyQuota);
  }

  /**
   * Check if a request from this key is allowed. Must call `release()` when done.
   * Returns a GuardResult. If `allowed` is false, the caller should respond with
   * the provided statusCode and error message immediately.
   */
  acquire(key: string, now = Date.now()): GuardResult {
    // 1. Daily quota
    if (!this.daily.tryConsume(key, now)) {
      return guardError(429, `Daily request limit reached (${this.daily['limit']}). Resets at midnight.`);
    }

    // 2. Minimum delay between requests
    if (!this.delay.tryRequest(key, now)) {
      const retryAfter = this.delay.retryAfter(key, now);
      return guardError(429, `Too fast — minimum ${this.delay['minIntervalMs']}ms between requests`, retryAfter);
    }

    // 3. Concurrent request limit
    if (!this.concurrency.tryAcquire(key)) {
      return guardError(429, `Too many concurrent requests (max ${this.concurrency['max']})`);
    }

    return ALLOWED;
  }

  /**
   * Release the concurrency slot for this key.
   * Must be called when the request completes (success, error, or stream ends).
   */
  release(key: string): void {
    this.concurrency.release(key);
  }

  /** Diagnostic counters — useful for monitoring. */
  stats(): { concurrent: number; dailyRemaining: (key: string) => number } {
    return {
      concurrent: this.concurrency.active,
      dailyRemaining: (key: string) => this.daily.remaining(key),
    };
  }
}

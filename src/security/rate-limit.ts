import type { OutgoingHttpHeaders } from 'node:http';

export interface RateLimitResult {
  readonly allowed: boolean;
  readonly limit: number;
  readonly remaining: number;
  readonly resetAt: number;
}

export class SlidingWindowRateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs = 60_000,
  ) {}

  check(key: string, now = Date.now()): RateLimitResult {
    const windowStart = now - this.windowMs;
    const currentHits = (this.hits.get(key) ?? []).filter((timestamp) => timestamp > windowStart);
    const allowed = currentHits.length < this.limit;

    if (allowed) {
      currentHits.push(now);
    }

    this.hits.set(key, currentHits);
    const oldest = currentHits[0] ?? now;
    const resetAt = oldest + this.windowMs;

    return {
      allowed,
      limit: this.limit,
      remaining: Math.max(this.limit - currentHits.length, 0),
      resetAt,
    };
  }
}

export function rateLimitHeaders(result: RateLimitResult): OutgoingHttpHeaders {
  return {
    'x-ratelimit-limit-requests': String(result.limit),
    'x-ratelimit-remaining-requests': String(result.remaining),
    'x-ratelimit-reset-requests': String(Math.ceil(result.resetAt / 1000)),
  };
}

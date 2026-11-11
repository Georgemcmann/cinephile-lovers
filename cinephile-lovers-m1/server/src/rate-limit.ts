/**
 * Tiny in-memory fixed-window rate limiter for room creation.
 *
 * This is a sanity brake, not a security boundary: the real control is the
 * single-instance deployment plus the per-IP window. Buckets are swept so a
 * long-running process cannot accumulate one entry per address forever.
 */
export type RateLimitDecision =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

type Bucket = {
  count: number;
  resetAt: number;
};

export class FixedWindowRateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  consume(key: string): RateLimitDecision {
    const now = this.now();
    const bucket = this.buckets.get(key);

    if (!bucket || now >= bucket.resetAt) {
      this.buckets.set(key, { count: 1, resetAt: now + this.windowMs });
      return { allowed: true };
    }

    if (bucket.count >= this.limit) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((bucket.resetAt - now) / 1_000),
        ),
      };
    }

    bucket.count += 1;
    return { allowed: true };
  }

  /** Drop expired buckets. Returns the number removed. */
  sweep(): number {
    const now = this.now();
    let removed = 0;
    for (const [key, bucket] of this.buckets) {
      if (now >= bucket.resetAt) {
        this.buckets.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  get size(): number {
    return this.buckets.size;
  }
}

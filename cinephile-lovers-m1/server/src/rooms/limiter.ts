/**
 * Minimal fixed-window rate limiter, per key (we key by IP for room
 * creation; M4 adds per-socket and per-IP keys for room:join).
 *
 * In-memory by design (single-instance constraint, brief §11). Clock is
 * injectable for tests. The map is swept opportunistically when it grows
 * large, so abandoned keys do not accumulate forever.
 *
 * NOTE (R8): this is keyed on req.ip. Behind Render, `trust proxy = 1`
 * must be re-verified in M7 BEFORE trusting these limits as meaningful —
 * until then they are a sanity brake, not a hard security boundary.
 */
export class FixedWindowLimiter {
  private readonly hits = new Map<string, { count: number; windowStart: number }>();
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly now: () => number;

  constructor(options: {
    limit: number;
    windowMs: number;
    now?: () => number;
  }) {
    this.limit = options.limit;
    this.windowMs = options.windowMs;
    this.now = options?.now ?? Date.now;
  }

  /** Returns true if the action is allowed for this key. */
  take(key: string): boolean {
    const now = this.now();
    if (this.hits.size > 10_000) {
      this.sweep(now);
    }
    const entry = this.hits.get(key);
    if (!entry || now - entry.windowStart >= this.windowMs) {
      this.hits.set(key, { count: 1, windowStart: now });
      return true;
    }
    entry.count += 1;
    return entry.count <= this.limit;
  }

  private sweep(now: number): void {
    for (const [key, entry] of this.hits) {
      if (now - entry.windowStart >= this.windowMs) {
        this.hits.delete(key);
      }
    }
  }
}
import { describe, expect, it } from "vitest";

import { FixedWindowRateLimiter } from "../src/rate-limit.js";

describe("room creation rate limiter", () => {
  it("allows up to the limit, then refuses until the window resets", () => {
    let now = 1_000_000;
    const limiter = new FixedWindowRateLimiter(2, 10_000, () => now);

    expect(limiter.consume("ip")).toEqual({ allowed: true });
    expect(limiter.consume("ip")).toEqual({ allowed: true });
    expect(limiter.consume("ip")).toEqual({
      allowed: false,
      retryAfterSeconds: 10,
    });

    now += 10_000;
    expect(limiter.consume("ip")).toEqual({ allowed: true });
  });

  it("keeps buckets separate per key and sweeps expired ones", () => {
    let now = 1_000_000;
    const limiter = new FixedWindowRateLimiter(1, 5_000, () => now);

    expect(limiter.consume("a")).toEqual({ allowed: true });
    expect(limiter.consume("b")).toEqual({ allowed: true });
    expect(limiter.consume("a").allowed).toBe(false);
    expect(limiter.size).toBe(2);

    now += 5_000;
    expect(limiter.sweep()).toBe(2);
    expect(limiter.size).toBe(0);
  });
});

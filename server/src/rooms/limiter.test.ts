import { describe, expect, it } from "vitest";

import { FixedWindowLimiter } from "./limiter.js";

describe("FixedWindowLimiter", () => {
  it("allows up to the limit, then blocks within the window", () => {
    let now = 0;
    const limiter = new FixedWindowLimiter({ limit: 3, windowMs: 1_000, now: () => now });
    expect(limiter.take("ip:a")).toBe(true);
    expect(limiter.take("ip:a")).toBe(true);
    expect(limiter.take("ip:a")).toBe(true);
    expect(limiter.take("ip:a")).toBe(false);
    expect(limiter.take("ip:a")).toBe(false);
  });

  it("opens a fresh window after the window passes", () => {
    let now = 0;
    const limiter = new FixedWindowLimiter({ limit: 2, windowMs: 1_000, now: () => now });
    expect(limiter.take("ip:a")).toBe(true);
    expect(limiter.take("ip:a")).toBe(true);
    expect(limiter.take("ip:a")).toBe(false);
    now = 1_500;
    expect(limiter.take("ip:a")).toBe(true);
    expect(limiter.take("ip:a")).toBe(true);
    expect(limiter.take("ip:a")).toBe(false);
  });

  it("keys are isolated from each other", () => {
    let now = 0;
    const limiter = new FixedWindowLimiter({ limit: 1, windowMs: 1_000, now: () => now });
    expect(limiter.take("ip:a")).toBe(true);
    expect(limiter.take("ip:a")).toBe(false);
    expect(limiter.take("ip:b")).toBe(true);
    expect(limiter.take("ip:b")).toBe(false);
  });
});
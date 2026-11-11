import assert from "node:assert/strict";
import { test } from "node:test";

import { FixedWindowRateLimiter } from "../src/rate-limit.js";

test("allows up to the limit, then refuses until the window resets", () => {
  let now = 1_000_000;
  const limiter = new FixedWindowRateLimiter(2, 10_000, () => now);

  assert.deepEqual(limiter.consume("ip"), { allowed: true });
  assert.deepEqual(limiter.consume("ip"), { allowed: true });

  const refused = limiter.consume("ip");
  assert.equal(refused.allowed, false);
  if (!refused.allowed) {
    assert.equal(refused.retryAfterSeconds, 10);
  }

  now += 10_000;
  assert.deepEqual(limiter.consume("ip"), { allowed: true });
});

test("keeps buckets separate per key and sweeps expired ones", () => {
  let now = 1_000_000;
  const limiter = new FixedWindowRateLimiter(1, 5_000, () => now);

  assert.deepEqual(limiter.consume("a"), { allowed: true });
  assert.deepEqual(limiter.consume("b"), { allowed: true });
  assert.equal(limiter.consume("a").allowed, false);
  assert.equal(limiter.size, 2);

  now += 5_000;
  assert.equal(limiter.sweep(), 2);
  assert.equal(limiter.size, 0);
});

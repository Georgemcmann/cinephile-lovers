import { Router } from "express";

import type { FixedWindowRateLimiter } from "../rate-limit.js";
import type { RoomStore } from "../rooms/store.js";

/**
 * POST /api/rooms — create one in-memory room.
 *
 * The response is the ONLY time the plaintext invite secret and recovery code
 * leave the server. Both are hashed at rest; the client must keep the invite
 * secret in the URL fragment and show the recovery code exactly once.
 */
export function roomsRouter(options: {
  store: RoomStore;
  limiter: FixedWindowRateLimiter;
}): Router {
  const router = Router();

  router.post("/api/rooms", (req, res) => {
    res.setHeader("Cache-Control", "no-store");

    const decision = options.limiter.consume(req.ip ?? "unknown");
    if (!decision.allowed) {
      res.setHeader("Retry-After", String(decision.retryAfterSeconds));
      res.status(429).json({ error: "rate_limited" });
      return;
    }

    const room = options.store.create();
    res.status(201).json({
      roomId: room.roomId,
      invitePath: `/room/${room.roomId}`,
      inviteSecret: room.inviteSecret,
      recoveryCode: room.recoveryCode,
      expiresAt: new Date(room.expiresAt).toISOString(),
    });
  });

  return router;
}

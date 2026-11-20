import { createServer } from "node:http";

import express, { type ErrorRequestHandler } from "express";

import { loadEnv } from "./config.js";
import { healthRouter } from "./http/health.js";
import { roomsRouter } from "./http/rooms.js";
import { originMiddleware } from "./origins.js";
import { FixedWindowRateLimiter } from "./rate-limit.js";
import { MembershipStore } from "./rooms/membership.js";
import { RoomStore } from "./rooms/store.js";
import { attachGateway } from "./sockets/gateway.js";

const env = loadEnv();

const app = express();
const roomStore = new RoomStore({
  ttlMs: env.ROOM_TTL_HOURS * 60 * 60_000,
});
const membershipStore = new MembershipStore();
const createRoomLimiter = new FixedWindowRateLimiter(
  env.ROOM_CREATE_RATE_LIMIT,
  env.ROOM_CREATE_RATE_WINDOW_MIN * 60_000,
);

// Behind Render's reverse proxy, trust exactly one proxy hop so req.ip is
// the real client IP for future per-IP rate limits (brief §6). M7 must
// verify on Render that req.ip shows the client address, not the proxy.
app.set("trust proxy", 1);
app.disable("x-powered-by");

// Strict CORS/origin allowlist for REST; Socket.IO gets the same list.
app.use(originMiddleware(env));

// REST bodies are tiny (room creation will be the biggest); hard cap early.
app.use(express.json({ limit: "16kb" }));

app.use(healthRouter());
app.use(roomsRouter({ store: roomStore, limiter: createRoomLimiter }));

// Unknown routes get the minimum answer, with no detail (brief §6).
app.use((_req, res) => {
  res.status(404).json({ error: "not_found" });
});

// Express's default error handler returns HTML and, in development, logs a
// stack trace. Keep error responses minimal and machine-readable instead.
const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (res.headersSent) return;

  const status =
    typeof err === "object" &&
    err !== null &&
    "status" in err &&
    typeof (err as { status?: unknown }).status === "number"
      ? (err as { status: number }).status
      : 500;
  const safeStatus = status >= 400 && status <= 599 ? status : 500;
  const code =
    safeStatus === 400
      ? "bad_request"
      : safeStatus === 413
        ? "payload_too_large"
        : safeStatus === 415
          ? "unsupported_media_type"
          : safeStatus >= 500
            ? "internal_error"
            : "request_failed";

  res.status(safeStatus).json({ error: code });
};

app.use(errorHandler);

const sweepTimer = setInterval(() => {
  const removed = roomStore.sweep();
  if (removed.length > 0) {
    // Rooms swept from the authoritative store must die in the membership
    // store too, otherwise an old token could still resume a dead room.
    membershipStore.drop(removed);
  }
  createRoomLimiter.sweep();
}, 60_000);
sweepTimer.unref();

const httpServer = createServer(app);
const io = attachGateway(httpServer, env, {
  roomStore,
  membershipStore,
});

httpServer.listen(env.PORT, () => {
  console.log(`cinephile server listening on :${env.PORT} (${env.NODE_ENV})`);
});

/**
 * Graceful shutdown: rooms are in-memory, so a restart ends every room
 * (brief §11, single-instance constraint). Draining cleanly at least lets
 * connected clients see an orderly disconnect instead of a hard TCP cut.
 */
function shutdown(signal: string): void {
  console.log(`${signal} received — shutting down`);
  clearInterval(sweepTimer);
  io.close();
  httpServer.close(() => process.exit(0));
  // Failsafe if connections refuse to drain.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
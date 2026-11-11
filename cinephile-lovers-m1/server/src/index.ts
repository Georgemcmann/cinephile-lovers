import { createServer } from "node:http";

import express from "express";

import { loadEnv } from "./config.js";
import { healthRouter } from "./http/health.js";
import { originMiddleware } from "./origins.js";
import { attachGateway } from "./sockets/gateway.js";

const env = loadEnv();

const app = express();

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

// Unknown routes get the minimum answer, with no detail (brief §6).
app.use((_req, res) => {
  res.status(404).json({ error: "not_found" });
});

const httpServer = createServer(app);
const io = attachGateway(httpServer, env);

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
  io.close();
  httpServer.close(() => process.exit(0));
  // Failsafe if connections refuse to drain.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

import type { Server as HttpServer } from "node:http";

import { Server as SocketIoServer } from "socket.io";

import type { Env } from "../config.js";
import { allowedOrigins } from "../origins.js";

/**
 * M1: Socket.IO is attached to the SAME http server as Express (one port),
 * with the same strict origin allowlist. This is infrastructure only —
 * there are no room, membership or playback events yet (M3/M4 scope).
 *
 * Security groundwork per brief §6:
 * - strict origin allowlist on the WebSocket handshake
 * - payload size capped (future chat/reaction events stay far below this)
 * - nothing sensitive is logged: no handshake auth, no tokens, no URLs
 */
export function attachGateway(httpServer: HttpServer, env: Env) {
  const origins = new Set(allowedOrigins(env));
  const io = new SocketIoServer(httpServer, {
    cors: {
      origin: [...origins],
      methods: ["GET", "POST"],
    },
    // CORS headers only protect HTTP polling. WebSocket upgrades are not
    // subject to CORS in browsers, so the Origin header must be checked here
    // for every handshake (polling and websocket alike).
    allowRequest: (req, callback) => {
      const origin = req.headers.origin;
      callback(null, typeof origin === "string" && origins.has(origin));
    },
    maxHttpBufferSize: 100_000, // 100 KB — planned events never approach this
    serveClient: false,
  });

  io.on("connection", (socket) => {
    console.log(`socket connected: ${socket.id}`);
    socket.on("disconnect", (reason) => {
      console.log(`socket disconnected: ${socket.id} (${reason})`);
    });
  });

  return io;
}

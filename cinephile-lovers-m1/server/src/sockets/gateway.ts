import { randomBytes } from "node:crypto";
import type { Server as HttpServer } from "node:http";

import { Server as SocketIoServer, type Socket } from "socket.io";
import { z } from "zod";

import type { Env } from "../config.js";
import { sha256Hex } from "../ids.js";
import { allowedOrigins } from "../origins.js";
import { FixedWindowLimiter } from "../rooms/limiter.js";
import {
  MembershipStore,
  type CommandResult,
  type Role,
  type RoomSnapshot,
  type SlotId,
  type SyncCommand,
} from "../rooms/membership.js";
import { RoomStore } from "../rooms/store.js";

/**
 * Socket gateway (M4, implements docs/token-design.md §3–§7 and the event
 * catalog in docs/socket-events.md; M5 adds the sync events §10–§13).
 *
 * Security shape:
 * - Strict origin allowlist on the handshake (same list as REST).
 * - Session resume happens ONLY via handshake auth { roomId, sessionToken };
 *   there are no cookies and the invite secret is never accepted here.
 * - Tokens are 256-bit, stored hashed, compared constant-time. Plaintext
 *   tokens are never logged (nothing sensitive is logged at all).
 * - maxHttpBufferSize caps every frame at 100 KB; event payloads are zod-
 *   validated far below that.
 * - join/recover/chat/reset/file/sync events are rate limited per socket
 *   and (where credentials are at stake) per IP. The IP is XFF-aware for
 *   ONE trusted proxy hop; M7 must re-verify this on Render before trusting
 *   per-IP limits as a hard boundary (R8).
 *
 * M5 sync shape (review R3):
 * - sync:command is the ONLY writer of the shared playback anchor; the
 *   broadcast goes to the WHOLE room including the sender — the echoed
 *   broadcast is what the originator matches for echo suppression.
 * - Over the per-socket command limit, the NEWEST command REPLACES the
 *   buffered one (latest wins) instead of being dropped, so a final seek
 *   after a scrub burst can never be discarded.
 * - When a seat drops while the movie plays, the server waits a short grace
 *   window (transient blips) and then pauses shared playback itself.
 */

const RoomIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{10,64}$/, "room id shape");
const Token43Schema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{43}$/, "base64url 43 chars");

const JoinSchema = z.object({
  roomId: RoomIdSchema,
  inviteSecret: Token43Schema,
});
const HelloSchema = z.object({ roomId: RoomIdSchema });
const RecoverSchema = z.object({
  roomId: RoomIdSchema,
  recoveryCode: z.string().min(8).max(64),
});
const ResetSchema = z.object({
  roomId: RoomIdSchema,
  recoveryCode: z.string().min(8).max(64).optional(),
});
const ChatSchema = z.object({ text: z.string().trim().min(1).max(500) });
const FileSchema = z.object({
  name: z.string().min(1).max(255),
  sizeBytes: z.number().int().positive(),
  durationSeconds: z.number().min(0).max(172_800),
});

// --- M5 sync schemas -------------------------------------------------------
// Positions are seconds, finite, non-negative; the ceiling matches the file
// duration cap (48 h). Duration plausibility stays CLIENT-side (review R4).
const PositionSchema = z.number().finite().min(0).max(172_800);
const SyncCommandSchema = z.object({
  kind: z.enum(["play", "pause", "seek"]),
  position: PositionSchema,
  // Client-assigned strictly increasing revision (timestamp-based, so it
  // survives reconnects of the same seat). System-generated pauses (the
  // shared-pause fallback) bypass revisions entirely with rev 0.
  rev: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
});
const ScrubSchema = z.object({ position: PositionSchema });
const StatusSchema = z.object({ buffering: z.boolean() });
const PingSchema = z.object({ tClient: z.number().finite() });

type Session = { roomId: string; slot: SlotId };

type AckError =
  | "invalid_payload"
  | "invalid_invite"
  | "invalid_recovery"
  | "unauthorized"
  | "already_joined"
  | "room_full"
  | "rate_limited"
  | "room_gone"
  | "stale_command"
  | "timeout";

export type Ack<T extends object = object> = (
  response: ({ ok: true } & T) | { ok: false; error: AckError },
) => void;

const MINUTE = 60_000;

type GatewayLimiters = {
  joinPerSocket: FixedWindowLimiter;
  joinPerIp: FixedWindowLimiter;
  recoverPerSocket: FixedWindowLimiter;
  recoverPerIp: FixedWindowLimiter;
  chatPerSocket: FixedWindowLimiter;
  resetPerSocket: FixedWindowLimiter;
  filePerSocket: FixedWindowLimiter;
  // M5 — all per-socket only: sync events require a seat-bound socket, so
  // there is no credential to guess and no per-IP brake is needed.
  syncPerSocket: FixedWindowLimiter;
  scrubPerSocket: FixedWindowLimiter;
  statusPerSocket: FixedWindowLimiter;
  pingPerSocket: FixedWindowLimiter;
};

function defaultLimiters(): GatewayLimiters {
  return {
    // Hard brake on credential guessing (token-design §7): 256-bit secrets
    // are not brute-forceable anyway; these bound abuse, not entropy.
    joinPerSocket: new FixedWindowLimiter({ limit: 10, windowMs: MINUTE }),
    joinPerIp: new FixedWindowLimiter({ limit: 30, windowMs: MINUTE }),
    recoverPerSocket: new FixedWindowLimiter({ limit: 5, windowMs: MINUTE }),
    recoverPerIp: new FixedWindowLimiter({ limit: 15, windowMs: MINUTE }),
    chatPerSocket: new FixedWindowLimiter({ limit: 20, windowMs: MINUTE }),
    resetPerSocket: new FixedWindowLimiter({ limit: 5, windowMs: MINUTE }),
    filePerSocket: new FixedWindowLimiter({ limit: 30, windowMs: MINUTE }),
    // M5. sync:command is deliberately generous (scrub bursts are legal);
    // over the limit commands COALESCE instead of erroring (see below).
    syncPerSocket: new FixedWindowLimiter({ limit: 60, windowMs: MINUTE }),
    // Indicator-only traffic: dropping over the limit degrades gracefully.
    scrubPerSocket: new FixedWindowLimiter({ limit: 120, windowMs: MINUTE }),
    statusPerSocket: new FixedWindowLimiter({ limit: 30, windowMs: MINUTE }),
    // Clock sampling bursts (5 on connect + periodic re-measure).
    pingPerSocket: new FixedWindowLimiter({ limit: 30, windowMs: MINUTE }),
  };
}

export type GatewayDeps = {
  /**
   * Required: the REST router and the gateway MUST share one store. A
   * defaulted/optional store here silently splits room state in two and
   * makes every freshly created invite fail with invalid_invite.
   */
  roomStore: RoomStore;
  membershipStore: MembershipStore;
  limiters?: Partial<GatewayLimiters>;
};

/**
 * One trusted proxy hop (mirror of Express `trust proxy = 1`): the LAST
 * XFF entry is the client; anything earlier can be forged by upstream
 * proxies we do not control. M7 re-verifies on Render (R8).
 */
function socketIp(socket: Socket): string {
  const forwarded = socket.request.headers["x-forwarded-for"];
  if (typeof forwarded === "string") {
    const hops = forwarded
      .split(",")
      .map((hop) => hop.trim())
      .filter((hop) => hop.length > 0);
    const last = hops.at(-1);
    if (last) return last;
  }
  return socket.handshake.address ?? "unknown";
}

const roomChannel = (roomId: string) => `room:${roomId}`;

// --- M5 timing constants (docs/participant-state-machine.md) ---------------
/** How long a rate-limited burst may hold the newest command before it is applied. */
const SYNC_COALESCE_MS = 300;
/** Grace window between a seat's socket drop and the server-side shared pause. */
const SHARED_PAUSE_DELAY_MS = 4_000;

function evict(io: SocketIoServer, socketId: string): void {
  // Small delay so the eviction event is flushed before the forced close.
  const target = io.sockets.sockets.get(socketId);
  if (!target) return;
  setTimeout(() => target.disconnect(true), 25).unref();
}

export function attachGateway(
  httpServer: HttpServer,
  env: Env,
  deps: GatewayDeps,
) {
  const { roomStore, membershipStore: membership } = deps;
  const limiters: GatewayLimiters = { ...defaultLimiters(), ...deps.limiters };
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

  // --- M5 sync plumbing -----------------------------------------------------
  // Latest-wins buffer for over-limit sync:command traffic, keyed by socket.
  const pendingCommands = new Map<
    string,
    { roomId: string; slot: SlotId; command: SyncCommand }
  >();
  const coalesceTimers = new Map<string, NodeJS.Timeout>();
  // Grace timers for the server-side shared pause, keyed by room.
  const sharedPauseTimers = new Map<string, NodeJS.Timeout>();

  function applyAndBroadcast(
    roomId: string,
    slot: SlotId,
    command: SyncCommand,
  ): CommandResult {
    const result = membership.applyCommand(roomId, slot, command);
    if (result.ok) {
      roomStore.touch(roomId);
      io.to(roomChannel(roomId)).emit("sync:command", {
        kind: command.kind,
        state: result.anchor.state,
        position: result.anchor.position,
        at: result.anchor.at,
        seq: result.anchor.seq,
        by: slot,
        rev: command.rev,
      });
    }
    return result;
  }

  function flushBuffered(socketId: string): void {
    coalesceTimers.delete(socketId);
    const buffered = pendingCommands.get(socketId);
    if (!buffered) return;
    pendingCommands.delete(socketId);
    applyAndBroadcast(buffered.roomId, buffered.slot, buffered.command);
  }

  function bufferCommand(
    socketId: string,
    roomId: string,
    slot: SlotId,
    command: SyncCommand,
  ): void {
    // Latest wins (R3): the newest command REPLACES the buffered one, so a
    // final seek after a scrub burst is never dropped. The timer is NOT
    // reset on replace — the flush stays bounded to one coalesce window
    // after the first buffered command; a later command simply starts a
    // fresh window after the flush.
    pendingCommands.set(socketId, { roomId, slot, command });
    if (!coalesceTimers.has(socketId)) {
      const timer = setTimeout(() => flushBuffered(socketId), SYNC_COALESCE_MS);
      timer.unref();
      coalesceTimers.set(socketId, timer);
    }
  }

  /**
   * R3 state-machine default: a seat dropped while the movie plays. After
   * the grace window (rides out transient blips), the SERVER pauses shared
   * playback at the position the playing side would have reached now.
   * Cancelled by any online transition of the room (resume/join/recover).
   */
  function armSharedPause(roomId: string): void {
    if (sharedPauseTimers.has(roomId)) return;
    const timer = setTimeout(() => {
      sharedPauseTimers.delete(roomId);
      const paused = membership.applySystemPause(roomId);
      if (paused) {
        io.to(roomChannel(roomId)).emit("sync:command", {
          kind: "pause",
          state: "paused" as const,
          position: paused.position,
          at: paused.at,
          seq: paused.seq,
          by: "system",
          rev: 0,
          reason: "partner_lost",
        });
      }
    }, SHARED_PAUSE_DELAY_MS);
    timer.unref();
    sharedPauseTimers.set(roomId, timer);
  }

  function cancelSharedPause(roomId: string): void {
    const timer = sharedPauseTimers.get(roomId);
    if (timer) {
      clearTimeout(timer);
      sharedPauseTimers.delete(roomId);
    }
  }

  // --- Handshake auth: session resume ONLY (token-design §3). A connection
  // without auth is allowed (it may still join with the secret); auth with
  // an unusable token is refused so dead sessions fail loudly.
  io.use((socket, next) => {
    const auth: unknown = socket.handshake.auth;
    if (typeof auth !== "object" || auth === null) return next();
    const candidate = auth as Record<string, unknown>;
    if (typeof candidate.sessionToken !== "string") return next(); // fresh
    const parsed = z
      .object({ roomId: RoomIdSchema, sessionToken: Token43Schema })
      .safeParse(candidate);
    if (!parsed.success) return next(new Error("bad_session"));
    const { roomId, sessionToken } = parsed.data;
    // Synchronous critical section: verify hash, re-bind seat, evict loser.
    const resumed = membership.resume(roomId, sha256Hex(sessionToken), socket.id);
    if (!resumed.ok) return next(new Error("bad_session"));
    socket.data.session = { roomId, slot: resumed.slot } satisfies Session;
    socket.join(roomChannel(roomId));
    // A seat coming back online cancels the pending shared pause.
    cancelSharedPause(roomId);
    if (resumed.evictedSocketId) {
      io.to(resumed.evictedSocketId).emit("session:replaced");
      evict(io, resumed.evictedSocketId);
    }
    next();
  });

  io.on("connection", (socket) => {
    const session = socket.data.session as Session | undefined;
    if (session) {
      console.log(`socket joined room (${socket.id})`);
      broadcastState(io, membership, session.roomId);
    }
    // NOTE: `session` above is only non-undefined for handshake-resumed
    // sockets — every event handler below MUST read socket.data.session
    // LIVE (the disconnect handler documents why).

    socket.on("disconnect", () => {
      // A buffered (rate-limited) command is still valid intent — apply it
      // best-effort before the seat drops.
      flushBuffered(socket.id);
      // Read the session LIVE: the connection-time closure is undefined for
      // sockets that joined via room:join AFTER connecting (a latent M4 bug
      // this milestone's suite caught — their disconnects silently no-op'd,
      // so the seat stayed "online" and no presence update was broadcast).
      const active = socket.data.session as Session | undefined;
      if (!active) return;
      // Claim survives; only the live binding drops (seat goes "offline").
      const slot = membership.unbindLive(active.roomId, socket.id);
      if (slot) {
        broadcastState(io, membership, active.roomId);
        armSharedPause(active.roomId);
      }
    });

    // --- room:hello — fetch the current snapshot (join acks and resumes
    // both land here for the freshest state).
    socket.on("room:hello", (payload: unknown, ack?: Ack<{
      you: { slot: SlotId; role: Role };
      snapshot: RoomSnapshot;
    }>) => {
      const reply = (response: Parameters<NonNullable<typeof ack>>[0]) => {
        if (typeof ack === "function") ack(response);
      };
      const active = socket.data.session as Session | undefined;
      if (!active) return reply({ ok: false, error: "unauthorized" });
      const parsed = HelloSchema.safeParse(payload);
      if (!parsed.success || parsed.data.roomId !== active.roomId) {
        return reply({ ok: false, error: "invalid_payload" });
      }
      const snapshot = membership.snapshot(active.roomId);
      if (!snapshot) return reply({ ok: false, error: "room_gone" });
      membership.touch(active.roomId);
      reply({
        ok: true,
        you: {
          slot: active.slot,
          role: active.slot === "A" ? "creator" : "partner",
        },
        snapshot,
      });
    });

    // --- room:join — the ONLY path that accepts the invite secret
    // (token-design §3). Claims the first free seat atomically.
    socket.on("room:join", (payload: unknown, ack?: Ack<{
      token: string;
      slot: SlotId;
      role: Role;
      snapshot: RoomSnapshot;
    }>) => {
      const reply = (response: Parameters<NonNullable<typeof ack>>[0]) => {
        if (typeof ack === "function") ack(response);
      };
      if (socket.data.session) return reply({ ok: false, error: "already_joined" });
      const parsed = JoinSchema.safeParse(payload);
      if (!parsed.success) return reply({ ok: false, error: "invalid_payload" });
      const { roomId, inviteSecret } = parsed.data;
      if (!limiters.joinPerSocket.take(`join:${socket.id}`)) {
        return reply({ ok: false, error: "rate_limited" });
      }
      if (!limiters.joinPerIp.take(`join:${socketIp(socket)}`)) {
        return reply({ ok: false, error: "rate_limited" });
      }

      // CRITICAL SECTION (token-design §5): from the secret check to the
      // seat claim there must be NO await — one event-loop tick makes the
      // check-and-set atomic. Code review rule: keep it that way.
      const secretOk = roomStore.verifySecret(roomId, inviteSecret);
      if (!secretOk) return reply({ ok: false, error: "invalid_invite" });
      membership.ensure(roomId);
      const token = randomBytes(32).toString("base64url");
      const claimed = membership.claim(roomId, sha256Hex(token), socket.id);
      if (!claimed.ok) return reply({ ok: false, error: "room_full" });
      // END CRITICAL SECTION

      roomStore.touch(roomId);
      socket.data.session = { roomId, slot: claimed.slot };
      socket.join(roomChannel(roomId));
      cancelSharedPause(roomId); // fresh seat — no ghost pause from the previous holder
      const snapshot = membership.snapshot(roomId);
      if (!snapshot) return reply({ ok: false, error: "room_gone" });
      reply({
        ok: true,
        token,
        slot: claimed.slot,
        role: claimed.role,
        snapshot,
      });
      broadcastState(io, membership, roomId);
    });

    // --- room:recover — creator escape hatch (token-design §3/§4). Hard
    // rate limited; re-mints the creator seat A; never touches B.
    socket.on("room:recover", (payload: unknown, ack?: Ack<{
      token: string;
      slot: SlotId;
      role: Role;
      snapshot: RoomSnapshot;
    }>) => {
      const reply = (response: Parameters<NonNullable<typeof ack>>[0]) => {
        if (typeof ack === "function") ack(response);
      };
      const parsed = RecoverSchema.safeParse(payload);
      if (!parsed.success) return reply({ ok: false, error: "invalid_payload" });
      const active = socket.data.session as Session | undefined;
      if (active && active.roomId !== parsed.data.roomId) {
        return reply({ ok: false, error: "invalid_payload" });
      }
      const { roomId, recoveryCode } = parsed.data;
      if (!limiters.recoverPerSocket.take(`recover:${socket.id}`)) {
        return reply({ ok: false, error: "rate_limited" });
      }
      if (!limiters.recoverPerIp.take(`recover:${socketIp(socket)}`)) {
        return reply({ ok: false, error: "rate_limited" });
      }

      // CRITICAL SECTION — same no-await rule as room:join.
      const codeOk = roomStore.verifyRecovery(roomId, recoveryCode);
      if (!codeOk) return reply({ ok: false, error: "invalid_recovery" });
      membership.ensure(roomId);
      const token = randomBytes(32).toString("base64url");
      const recovered = membership.recover(roomId, sha256Hex(token), socket.id);
      if (!recovered.ok) return reply({ ok: false, error: "invalid_recovery" });
      // END CRITICAL SECTION

      roomStore.touch(roomId);
      socket.data.session = { roomId, slot: "A" };
      socket.join(roomChannel(roomId));
      cancelSharedPause(roomId);
      const snapshot = membership.snapshot(roomId);
      if (!snapshot) return reply({ ok: false, error: "room_gone" });
      reply({ ok: true, token, slot: "A", role: "creator", snapshot });
      if (recovered.evictedSocketId) {
        io.to(recovered.evictedSocketId).emit("session:replaced");
        evict(io, recovered.evictedSocketId);
      }
      broadcastState(io, membership, roomId);
    });

    // --- room:reset-slot — creator token OR recovery code frees the
    // PARTNER seat (token-design §4). Its live socket gets the dedicated
    // session:terminated { reason: "reset" } — NOT session:replaced, the
    // semantics differ (seat freed, not taken over).
    socket.on(
      "room:reset-slot",
      (payload: unknown, ack?: Ack<{ freed: boolean }>) => {
        const reply = (response: Parameters<NonNullable<typeof ack>>[0]) => {
          if (typeof ack === "function") ack(response);
        };
        const parsed = ResetSchema.safeParse(payload);
        if (!parsed.success) return reply({ ok: false, error: "invalid_payload" });
        const { roomId, recoveryCode } = parsed.data;
        const active = socket.data.session as Session | undefined;
        if (active && active.roomId !== roomId) {
          return reply({ ok: false, error: "invalid_payload" });
        }
        if (!limiters.resetPerSocket.take(`reset:${socket.id}`)) {
          return reply({ ok: false, error: "rate_limited" });
        }
        const isCreator = active !== undefined && active.slot === "A";
        const codeOk = recoveryCode
          ? roomStore.verifyRecovery(roomId, recoveryCode)
          : false;
        if (!isCreator && !codeOk) {
          return reply({ ok: false, error: "unauthorized" });
        }
        const { freed, evictedSocketId } = membership.freePartnerSeat(roomId);
        roomStore.touch(roomId);
        // The partner seat is GONE, not dropped: any armed shared pause was
        // for a seat that no longer exists.
        cancelSharedPause(roomId);
        reply({ ok: true, freed });
        if (evictedSocketId) {
          io.to(evictedSocketId).emit("session:terminated", {
            reason: "reset",
          });
          evict(io, evictedSocketId);
        }
        broadcastState(io, membership, roomId);
      },
    );

    // --- chat:send — tiny text broadcast, no local echo: everyone
    // (including the sender) renders the server's broadcast. The ack is
    // OPTIONAL on the wire: fire-and-forget emitters are processed too.
    socket.on("chat:send", (payload: unknown, ack?: Ack<{ id: number }>) => {
      const reply = (response: Parameters<NonNullable<typeof ack>>[0]) => {
        if (typeof ack === "function") ack(response);
      };
      const active = socket.data.session as Session | undefined;
      if (!active) return reply({ ok: false, error: "unauthorized" });
      const parsed = ChatSchema.safeParse(payload);
      if (!parsed.success) return reply({ ok: false, error: "invalid_payload" });
      if (!limiters.chatPerSocket.take(`chat:${socket.id}`)) {
        return reply({ ok: false, error: "rate_limited" });
      }
      const message = membership.addChat(active.roomId, active.slot, parsed.data.text);
      if (!message) return reply({ ok: false, error: "room_gone" });
      roomStore.touch(active.roomId);
      io.to(roomChannel(active.roomId)).emit("chat:message", message);
      reply({ ok: true, id: message.id });
    });

    // --- file:announce — local file METADATA only (name/size/duration).
    // No file content ever travels (brief §2). Ack optional (see chat).
    socket.on("file:announce", (payload: unknown, ack?: Ack) => {
      const reply = (response: { ok: true } | { ok: false; error: AckError }) => {
        if (typeof ack === "function") ack(response);
      };
      const active = socket.data.session as Session | undefined;
      if (!active) return reply({ ok: false, error: "unauthorized" });
      const parsed = FileSchema.safeParse(payload);
      if (!parsed.success) return reply({ ok: false, error: "invalid_payload" });
      if (!limiters.filePerSocket.take(`file:${socket.id}`)) {
        return reply({ ok: false, error: "rate_limited" });
      }
      membership.setFile(active.roomId, active.slot, parsed.data);
      roomStore.touch(active.roomId);
      const snapshot = membership.snapshot(active.roomId);
      if (snapshot) {
        io.to(roomChannel(active.roomId)).emit("file:state", {
          files: snapshot.files,
        });
      }
      reply({ ok: true });
    });

    // --- sync:ping — one clock sample (M5). The client fires small bursts
    // and keeps the LOWEST-RTT sample (NTP-style offset estimation) and
    // re-measures on reconnect + periodically. Needs a seat: useless before
    // membership and it keeps unauthenticated traffic boring.
    socket.on("sync:ping", (payload: unknown, ack?: Ack<{ tServer: number }>) => {
      const reply = (response: Parameters<NonNullable<typeof ack>>[0]) => {
        if (typeof ack === "function") ack(response);
      };
      const active = socket.data.session as Session | undefined;
      if (!active) return reply({ ok: false, error: "unauthorized" });
      const parsed = PingSchema.safeParse(payload);
      if (!parsed.success) return reply({ ok: false, error: "invalid_payload" });
      if (!limiters.pingPerSocket.take(`ping:${socket.id}`)) {
        return reply({ ok: false, error: "rate_limited" });
      }
      reply({ ok: true, tServer: Date.now() });
    });

    // --- sync:command — the ONLY writer of the shared playback anchor.
    // The broadcast goes to the WHOLE room INCLUDING the sender: the echoed
    // broadcast is the originator's echo-suppression key (R3). Over the
    // per-socket limit the newest command is buffered and applied at most
    // one coalesce window later — never dropped, never errored.
    socket.on(
      "sync:command",
      (
        payload: unknown,
        ack?: Ack<{ seq?: number; at?: number; coalesced?: boolean }>,
      ) => {
        const reply = (response: Parameters<NonNullable<typeof ack>>[0]) => {
          if (typeof ack === "function") ack(response);
        };
        const active = socket.data.session as Session | undefined;
        if (!active) return reply({ ok: false, error: "unauthorized" });
        const parsed = SyncCommandSchema.safeParse(payload);
        if (!parsed.success) return reply({ ok: false, error: "invalid_payload" });
        if (!limiters.syncPerSocket.take(`sync:${socket.id}`)) {
          bufferCommand(socket.id, active.roomId, active.slot, parsed.data);
          return reply({ ok: true, coalesced: true });
        }
        const result = applyAndBroadcast(active.roomId, active.slot, parsed.data);
        if (!result.ok) {
          return reply({ ok: false, error: result.error });
        }
        reply({ ok: true, seq: result.anchor.seq, at: result.anchor.at });
      },
    );

    // --- sync:scrub — live scrub indicator, NOT an anchor change. Relayed
    // to the partner only (the sender shows their own scrub). Over the
    // limit: silently dropped — the indicator degrades, nothing breaks.
    socket.on("sync:scrub", (payload: unknown, ack?: Ack) => {
      const reply = (response: { ok: true } | { ok: false; error: AckError }) => {
        if (typeof ack === "function") ack(response);
      };
      const active = socket.data.session as Session | undefined;
      if (!active) return reply({ ok: false, error: "unauthorized" });
      const parsed = ScrubSchema.safeParse(payload);
      if (!parsed.success) return reply({ ok: false, error: "invalid_payload" });
      if (limiters.scrubPerSocket.take(`scrub:${socket.id}`)) {
        socket.broadcast.to(roomChannel(active.roomId)).emit("sync:scrub", {
          position: parsed.data.position,
          by: active.slot,
        });
      }
      reply({ ok: true });
    });

    // --- sync:status — buffering indicator (R3: indicator FIRST; any
    // shared-pause-on-buffering is deferred until device testing). Partner
    // only, same graceful degradation as scrub.
    socket.on("sync:status", (payload: unknown, ack?: Ack) => {
      const reply = (response: { ok: true } | { ok: false; error: AckError }) => {
        if (typeof ack === "function") ack(response);
      };
      const active = socket.data.session as Session | undefined;
      if (!active) return reply({ ok: false, error: "unauthorized" });
      const parsed = StatusSchema.safeParse(payload);
      if (!parsed.success) return reply({ ok: false, error: "invalid_payload" });
      if (limiters.statusPerSocket.take(`status:${socket.id}`)) {
        socket.broadcast.to(roomChannel(active.roomId)).emit("sync:status", {
          buffering: parsed.data.buffering,
          by: active.slot,
        });
      }
      reply({ ok: true });
    });
  });

  return io;
}

function broadcastState(
  io: SocketIoServer,
  membership: MembershipStore,
  roomId: string,
): void {
  const snapshot = membership.snapshot(roomId);
  if (snapshot) {
    io.to(roomChannel(roomId)).emit("room:state", { slots: snapshot.slots });
  }
}
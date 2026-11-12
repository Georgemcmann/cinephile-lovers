/**
 * Room socket wiring (M4 + M5, mirrors docs/socket-events.md exactly — the
 * two type sets are deliberately kept line-for-line in sync with the doc;
 * the server is the authority and its acks are validated by shape at runtime
 * where it matters).
 *
 * - One socket per room page mount. StrictMode double-mounting creates one
 *   extra connect cycle; the server's newest-wins rule absorbs that by
 *   design (it is the same behavior as a user opening a second tab).
 * - After a successful join/recover, socket.auth is UPDATED so every
 *   future reconnect resumes by token instead of falling back to nothing.
 * - M5 adds the sync event surface (§10–§13): commands, scrub/status
 *   indicators and the clock ping. All emitters here are transport only —
 *   policy (echo suppression, throttling, drift) lives in lib/sync-engine.
 */

import { io, type Socket } from "socket.io-client";

import type { SlotId, StoredSession } from "./session-store";

export type { SlotId };

const SOCKET_BASE =
  process.env.NEXT_PUBLIC_SOCKET_URL ?? "http://localhost:4000";

export type Role = "creator" | "partner";

export type FileMeta = {
  name: string;
  sizeBytes: number;
  durationSeconds: number;
};

export type ChatMessage = {
  id: number;
  from: SlotId;
  text: string;
  at: string;
};

export type SlotSummary = { occupied: boolean; online: boolean };

// --- M5 sync types (mirror of docs/socket-events.md §10–§13) ---------------

export type PlaybackBy = SlotId | "system";

/** The shared playback anchor; `position` is valid at server time `at`. */
export type PlaybackAnchor = {
  state: "playing" | "paused";
  position: number;
  at: number;
  seq: number;
  by: PlaybackBy;
};

/** Broadcast payload of sync:command (the anchor move, with who + why). */
export type SyncCommandPayload = PlaybackAnchor & {
  kind: "play" | "pause" | "seek";
  /** The originator's client revision; system pauses use 0. */
  rev: number;
  /** Present on system-generated pauses. */
  reason?: "partner_lost";
};

export type SyncScrubPayload = { position: number; by: SlotId };
export type SyncStatusPayload = { buffering: boolean; by: SlotId };

export type Snapshot = {
  slots: { A: SlotSummary; B: SlotSummary };
  files: { A: FileMeta | null; B: FileMeta | null };
  chat: ChatMessage[];
  /** Additive M5 field: null until the room's first playback command. */
  playback: PlaybackAnchor | null;
};

export type JoinAck =
  | { ok: true; token: string; slot: SlotId; role: Role; snapshot: Snapshot }
  | { ok: false; error: string };

export type HelloAck =
  | { ok: true; you: { slot: SlotId; role: Role }; snapshot: Snapshot }
  | { ok: false; error: string };

export type RecoverAck = JoinAck;
export type ResetAck = { ok: true; freed: boolean } | { ok: false; error: string };
export type SimpleAck = { ok: true } | { ok: false; error: string };

export function createRoomSocket(
  roomId: string,
  stored: StoredSession | null,
): Socket {
  return io(SOCKET_BASE, {
    // Resume by token when we have one; otherwise announce the room so the
    // middleware can still validate the shape (a bare roomId is a fresh
    // connection, not a failed resume).
    auth: stored ? { roomId, sessionToken: stored.token } : { roomId },
    transports: ["websocket", "polling"],
    reconnection: true,
    reconnectionDelay: 1_000,
    reconnectionDelayMax: 5_000,
  });
}

export function upgradeAuth(socket: Socket, roomId: string, token: string): void {
  // socket.io re-reads socket.auth on every connection attempt, so future
  // reconnects resume by token (room-socket.ts header note).
  socket.auth = { roomId, sessionToken: token };
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const ACK_MS = 10_000;

export async function joinRoom(
  socket: Socket,
  roomId: string,
  inviteSecret: string,
): Promise<JoinAck> {
  const response = await withTimeout(
    socket.timeout(ACK_MS).emitWithAck("room:join", { roomId, inviteSecret }),
    ACK_MS + 2_000,
  );
  return (response as JoinAck | null) ?? { ok: false, error: "timeout" };
}

export async function helloRoom(socket: Socket, roomId: string): Promise<HelloAck> {
  const response = await withTimeout(
    socket.timeout(ACK_MS).emitWithAck("room:hello", { roomId }),
    ACK_MS + 2_000,
  );
  return (response as HelloAck | null) ?? { ok: false, error: "timeout" };
}

export async function recoverRoom(
  socket: Socket,
  roomId: string,
  recoveryCode: string,
): Promise<RecoverAck> {
  const response = await withTimeout(
    socket
      .timeout(ACK_MS)
      .emitWithAck("room:recover", { roomId, recoveryCode }),
    ACK_MS + 2_000,
  );
  return (response as RecoverAck | null) ?? { ok: false, error: "timeout" };
}

export async function resetSlot(
  socket: Socket,
  roomId: string,
): Promise<ResetAck> {
  const response = await withTimeout(
    socket.timeout(ACK_MS).emitWithAck("room:reset-slot", { roomId }),
    ACK_MS + 2_000,
  );
  return (response as ResetAck | null) ?? { ok: false, error: "timeout" };
}

export function sendChat(socket: Socket, text: string): void {
  socket.emit("chat:send", { text });
}

export function announceFile(
  socket: Socket,
  meta: { name: string; sizeBytes: number; durationSeconds: number },
): void {
  socket.emit("file:announce", meta);
}

// --- M5 sync emitters (transport only; see lib/sync-engine.ts) -------------

/** Fire-and-forget by design: the broadcast drives state, the ack is a
 *  nicety the server may skip (docs/socket-events.md §2). */
export function sendSyncCommand(
  socket: Socket,
  command: { kind: "play" | "pause" | "seek"; position: number; rev: number },
): void {
  socket.emit("sync:command", command);
}

export function sendScrub(socket: Socket, position: number): void {
  socket.emit("sync:scrub", { position });
}

export function sendStatus(socket: Socket, buffering: boolean): void {
  socket.emit("sync:status", { buffering });
}

export type ClockPingAck =
  | { ok: true; tServer: number }
  | { ok: false; error: string };

export async function pingClock(socket: Socket, tClient: number): Promise<ClockPingAck> {
  const response = await withTimeout(
    socket.timeout(3_000).emitWithAck("sync:ping", { tClient }),
    4_000,
  );
  return (response as ClockPingAck | null) ?? { ok: false, error: "timeout" };
}
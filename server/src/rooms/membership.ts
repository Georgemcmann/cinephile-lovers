import { timingSafeEqual } from "node:crypto";

/**
 * Live membership (M4, implements docs/token-design.md §3–§5; M5 adds the
 * shared playback anchor, §10–§13 of docs/socket-events.md).
 *
 * Model:
 * - Two anonymous seats, A and B. Claim order defines them: the FIRST claim
 *   always takes A, so A is the creator seat and B the partner seat.
 * - A seat is either UNCLAIMED (null — the invite secret still works for it)
 *   or CLAIMED (holds a sha-256 session-token hash). A claimed seat carries
 *   an OPTIONAL live socket binding: null binding = claimed but offline.
 * - The invite secret is dead for new joins once both seats are claimed,
 *   regardless of online status. Disconnect does NOT free a claim.
 * - Newest socket wins within a seat (token-design §3): resume/claim with a
 *   valid credential re-binds the seat and the previous live socket is
 *   evicted (the gateway emits session:replaced for it).
 *
 * Playback anchor (M5):
 * - ONE authoritative intent per room: { state, position, at, seq, by }.
 *   `position` is the position at server time `at`; receivers project it
 *   forward with wall-clock time (rate is fixed at 1x in M5).
 * - `seq` is a per-room monotonic counter — every accepted command bumps it.
 * - `lastRev` is the newest client revision accepted PER SLOT: a client
 *   assigns strictly increasing revisions (timestamp-based), so a late
 *   duplicate or reordered command is rejected as stale instead of
 *   overwriting newer intent (review R3 "latest wins").
 *
 * Atomicity (token-design §5): every claim/resume/recover/playback method is
 * fully synchronous — no await anywhere inside — so under Node's single
 * event loop, two simultaneous joins can never take the same last seat and
 * two commands can never interleave half-applied. This is enforced by code
 * review rule; keep it that way.
 *
 * Security: only sha-256 hashes of session tokens are stored. Plaintext
 * tokens exist exactly once — in the join/recover ack — and are never
 * logged and never retrievable.
 */

export type SlotId = "A" | "B";
export const SLOT_IDS = ["A", "B"] as const;

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

export type SlotClaim = {
  /** sha-256 of the active session token; the plaintext never persists. */
  tokenHash: string;
  /** Live socket bound to this seat, or null = claimed but offline. */
  socketId: string | null;
};

export type Membership = {
  roomId: string;
  slots: { A: SlotClaim | null; B: SlotClaim | null };
  files: { A: FileMeta | null; B: FileMeta | null };
  chat: ChatMessage[];
  chatSeq: number;
  /** Shared playback intent; null until the room's first command. */
  playback: PlaybackAnchor | null;
  /** Per-room monotonic playback sequence (inside `playback.seq`). */
  playbackSeq: number;
  /** Newest accepted client revision per slot (stale-command guard). */
  lastRev: { A: number; B: number };
  lastActivityAt: number;
};

/** Chat history kept per room so a rejoining device can catch up. */
export const CHAT_HISTORY_LIMIT = 50;

export type Role = "creator" | "partner";

export type ClaimResult =
  | { ok: true; slot: SlotId; role: Role }
  | { ok: false; error: "room_full" };

export type ResumeResult =
  | {
      ok: true;
      slot: SlotId;
      role: Role;
      /** Live socket evicted from this seat (newest wins), if any. */
      evictedSocketId: string | null;
    }
  | { ok: false };

export type RecoverResult =
  | {
      ok: true;
      slot: "A";
      /** Live socket that sat in A (a stale creator tab), if any. */
      evictedSocketId: string | null;
      /** Seat released because the recovering session itself held it. */
      freedSlot: SlotId | null;
    }
  | { ok: false; error: "invalid_recovery" };

export type SlotSummary = { occupied: boolean; online: boolean };

// --- Playback anchor (M5) -------------------------------------------------

export type PlaybackState = "playing" | "paused";
/** Who last moved the shared playback: seat A/B, or the server itself. */
export type PlaybackBy = SlotId | "system";

/**
 * The single source of truth for shared playback. `position` is valid AT
 * server time `at` (epoch ms); with state "playing" receivers project it
 * forward: expectedNow(at nowMs) = position + (nowMs - at) / 1000.
 */
export type PlaybackAnchor = {
  state: PlaybackState;
  position: number;
  at: number;
  seq: number;
  by: PlaybackBy;
};

export type SyncCommand = {
  kind: "play" | "pause" | "seek";
  /** Element position at emit time; REQUIRED for every kind. */
  position: number;
  /** Client-assigned strictly increasing revision (timestamp-based). */
  rev: number;
};

export type CommandResult =
  | { ok: true; anchor: PlaybackAnchor }
  | { ok: false; error: "stale_command" | "room_gone" };

export type RoomSnapshot = {
  slots: { A: SlotSummary; B: SlotSummary };
  files: { A: FileMeta | null; B: FileMeta | null };
  chat: ChatMessage[];
  /** Additive M5 field: null until the first playback command of the room. */
  playback: PlaybackAnchor | null;
};

/** Matches the file duration cap (FileMeta) — 48 h of movie is plenty. */
const MAX_POSITION_SECONDS = 172_800;

function clampPosition(position: number): number {
  if (!Number.isFinite(position) || position <= 0) return 0;
  return Math.min(position, MAX_POSITION_SECONDS);
}

export class MembershipStore {
  private readonly rooms = new Map<string, Membership>();
  private readonly now: () => number;

  constructor(options?: { now?: () => number }) {
    this.now = options?.now ?? Date.now;
  }

  /** Get or lazily create the membership record for an EXISTING room. */
  ensure(roomId: string): Membership {
    let membership = this.rooms.get(roomId);
    if (!membership) {
      membership = {
        roomId,
        slots: { A: null, B: null },
        files: { A: null, B: null },
        chat: [],
        chatSeq: 0,
        playback: null,
        playbackSeq: 0,
        lastRev: { A: 0, B: 0 },
        lastActivityAt: this.now(),
      };
      this.rooms.set(roomId, membership);
    }
    return membership;
  }

  get(roomId: string): Membership | undefined {
    return this.rooms.get(roomId);
  }

  /** Rooms swept out of the RoomStore die here too (one process, one truth). */
  drop(roomIds: readonly string[]): void {
    for (const roomId of roomIds) {
      this.rooms.delete(roomId);
    }
  }

  /** Extend the room's activity clock — joins and meaningful events. */
  touch(roomId: string): void {
    const membership = this.rooms.get(roomId);
    if (membership) {
      membership.lastActivityAt = this.now();
    }
  }

  /** The seat this socket currently holds live, if any. */
  liveSlotOf(roomId: string, socketId: string): SlotId | null {
    const membership = this.rooms.get(roomId);
    if (!membership) return null;
    for (const slot of SLOT_IDS) {
      if (membership.slots[slot]?.socketId === socketId) return slot;
    }
    return null;
  }

  /**
   * Atomic seat claim (token-design §5). The caller verifies the invite
   * secret and mints the token BEFORE calling; there is no await anywhere
   * in the handler between those steps and this claim.
   */
  claim(roomId: string, tokenHash: string, socketId: string): ClaimResult {
    const membership = this.rooms.get(roomId);
    if (!membership) return { ok: false, error: "room_full" };
    for (const slot of SLOT_IDS) {
      if (membership.slots[slot] === null) {
        membership.slots[slot] = { tokenHash, socketId };
        membership.lastActivityAt = this.now();
        return { ok: true, slot, role: slot === "A" ? "creator" : "partner" };
      }
    }
    return { ok: false, error: "room_full" };
  }

  /**
   * Resume by session token (handshake auth, token-design §3). Valid hash
   * re-binds the seat; the previous live socket (another tab/device of the
   * SAME session) is evicted — newest wins. The invite secret is neither
   * needed nor accepted here.
   */
  resume(roomId: string, tokenHash: string, socketId: string): ResumeResult {
    const membership = this.rooms.get(roomId);
    if (!membership) return { ok: false };
    for (const slot of SLOT_IDS) {
      const claim = membership.slots[slot];
      if (!claim || !hashEquals(claim.tokenHash, tokenHash)) continue;
      const evictedSocketId =
        claim.socketId !== null && claim.socketId !== socketId
          ? claim.socketId
          : null;
      claim.socketId = socketId;
      membership.lastActivityAt = this.now();
      return {
        ok: true,
        slot,
        role: slot === "A" ? "creator" : "partner",
        evictedSocketId,
      };
    }
    return { ok: false };
  }

  /**
   * Creator recovery (token-design §3/§4): the recovery-code holder
   * re-asserts the creator seat A. By construction only creator-lineage
   * sessions can sit in A, so this never evicts a partner seat. If the
   * recovering session itself currently holds B, that claim (and its file
   * metadata) is released so a new partner can join by link.
   */
  recover(roomId: string, tokenHash: string, socketId: string): RecoverResult {
    const membership = this.rooms.get(roomId);
    if (!membership) return { ok: false, error: "invalid_recovery" };
    const claimA = membership.slots.A;
    const evictedSocketId =
      claimA && claimA.socketId !== null && claimA.socketId !== socketId
        ? claimA.socketId
        : null;
    let freedSlot: SlotId | null = null;
    const heldSlot = this.liveSlotOf(roomId, socketId);
    if (heldSlot !== null && heldSlot !== "A") {
      membership.slots[heldSlot] = null;
      membership.files[heldSlot] = null;
      freedSlot = heldSlot;
    }
    membership.slots.A = { tokenHash, socketId };
    membership.lastActivityAt = this.now();
    return { ok: true, slot: "A", evictedSocketId, freedSlot };
  }

  /**
   * Free the partner seat (creator reset, token-design §4). The seat and
   * its file metadata are wiped; its live socket (if any) is returned so
   * the gateway can send it session:terminated { reason: "reset" }.
   */
  freePartnerSeat(roomId: string): {
    freed: boolean;
    evictedSocketId: string | null;
  } {
    const membership = this.rooms.get(roomId);
    if (!membership) return { freed: false, evictedSocketId: null };
    const claim = membership.slots.B;
    if (!claim) return { freed: false, evictedSocketId: null };
    membership.slots.B = null;
    membership.files.B = null;
    membership.lastActivityAt = this.now();
    return { freed: true, evictedSocketId: claim.socketId };
  }

  /**
   * Drop the live binding on disconnect. The CLAIM survives: the seat stays
   * taken (offline) and the token still resumes it. Returns the affected
   * seat so the gateway can broadcast presence.
   */
  unbindLive(roomId: string, socketId: string): SlotId | null {
    const membership = this.rooms.get(roomId);
    if (!membership) return null;
    for (const slot of SLOT_IDS) {
      const claim = membership.slots[slot];
      if (claim && claim.socketId === socketId) {
        claim.socketId = null;
        return slot;
      }
    }
    return null;
  }

  setFile(roomId: string, slot: SlotId, meta: FileMeta): void {
    const membership = this.rooms.get(roomId);
    if (!membership) return;
    membership.files[slot] = meta;
    membership.lastActivityAt = this.now();
  }

  addChat(roomId: string, slot: SlotId, text: string): ChatMessage | null {
    const membership = this.rooms.get(roomId);
    if (!membership) return null;
    membership.chatSeq += 1;
    const message: ChatMessage = {
      id: membership.chatSeq,
      from: slot,
      text,
      at: new Date().toISOString(),
    };
    membership.chat.push(message);
    if (membership.chat.length > CHAT_HISTORY_LIMIT) {
      membership.chat.splice(0, membership.chat.length - CHAT_HISTORY_LIMIT);
    }
    membership.lastActivityAt = this.now();
    return message;
  }

  /**
   * Apply a playback command from a seat (M5). Fully synchronous — the
   * stale-rev check and the anchor update happen in one event-loop tick.
   *
   * "seek" preserves the current state (seeking while paused stays paused);
   * the FIRST command of a room creates the anchor — a first seek anchors as
   * "paused" at the target, a first play/play-pause at the given position.
   */
  applyCommand(roomId: string, by: SlotId, command: SyncCommand): CommandResult {
    const membership = this.rooms.get(roomId);
    if (!membership) return { ok: false, error: "room_gone" };
    if (command.rev <= membership.lastRev[by]) {
      return { ok: false, error: "stale_command" };
    }
    const position = clampPosition(command.position);
    const previous = membership.playback;
    const state: PlaybackState =
      command.kind === "play"
        ? "playing"
        : command.kind === "pause"
          ? "paused"
          : (previous?.state ?? "paused");
    membership.playbackSeq += 1;
    const anchor: PlaybackAnchor = {
      state,
      position,
      at: this.now(),
      seq: membership.playbackSeq,
      by,
    };
    membership.playback = anchor;
    membership.lastRev[by] = command.rev;
    membership.lastActivityAt = this.now();
    return { ok: true, anchor };
  }

  /**
   * The shared-pause fallback (R3): a seat dropped its socket while the
   * movie was playing. The SERVER pauses at the position the playing side
   * would have reached NOW (server clock — no client offset involved).
   * Returns null when there is nothing to pause (no anchor / already
   * paused / room gone); never rejects revisions — the system outranks
   * seats. Synchronous, like every other mutator here.
   */
  applySystemPause(roomId: string): PlaybackAnchor | null {
    const membership = this.rooms.get(roomId);
    if (!membership) return null;
    const previous = membership.playback;
    // Nothing is playing (or nothing has ever played): do NOT invent a
    // paused anchor. An idle-room disconnect is not a playback event.
    if (!previous || previous.state !== "playing") return null;
    const now = this.now();
    const position = clampPosition(previous.position + (now - previous.at) / 1000);
    membership.playbackSeq += 1;
    const anchor: PlaybackAnchor = {
      state: "paused",
      position,
      at: now,
      seq: membership.playbackSeq,
      by: "system",
    };
    membership.playback = anchor;
    membership.lastActivityAt = now;
    return anchor;
  }

  /**
   * Project the anchor to a wall-clock instant (server ms). Null when the
   * room has no anchor yet or is paused (position frozen).
   */
  expectedPositionAt(roomId: string, nowMs: number): number | null {
    const membership = this.rooms.get(roomId);
    if (!membership) return null;
    const anchor = membership.playback;
    if (!anchor) return null;
    if (anchor.state !== "playing") return anchor.position;
    return clampPosition(anchor.position + (nowMs - anchor.at) / 1000);
  }

  snapshot(roomId: string): RoomSnapshot | null {
    const membership = this.rooms.get(roomId);
    if (!membership) return null;
    const summarize = (slot: SlotId): SlotSummary => {
      const claim = membership.slots[slot];
      return {
        occupied: claim !== null,
        online: claim !== null && claim.socketId !== null,
      };
    };
    return {
      slots: { A: summarize("A"), B: summarize("B") },
      files: { A: membership.files.A, B: membership.files.B },
      chat: [...membership.chat],
      playback: membership.playback ? { ...membership.playback } : null,
    };
  }
}

function hashEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
import { timingSafeEqual } from "node:crypto";

import {
  generateInviteSecret,
  generateRecoveryCode,
  generateRoomId,
  normalizeRecoveryCode,
  sha256Hex,
} from "../ids.js";

/**
 * In-memory room store (single-instance constraint, brief §11): a restart
 * ends all rooms; the UI shows a "room lost" screen (M4 UX).
 *
 * Security shape (R2):
 * - The store holds ONLY sha-256 hashes of the invite secret and the
 *   recovery code. Plaintext values exist exactly once — in the creation
 *   response — and are never retrievable afterwards.
 * - Verification compares hashes with crypto.timingSafeEqual (constant
 *   time); unknown rooms fail WITHOUT leaking timing of the hash step.
 */
export type RoomRecord = {
  roomId: string;
  secretHash: string;
  recoveryHash: string;
  createdAt: number;
  lastActivityAt: number;
};

export type CreatedRoom = RoomRecord & {
  inviteSecret: string;
  recoveryCode: string;
  /** Wall-clock expiry of the room's current TTL window. */
  expiresAt: number;
};

export class RoomStore {
  private readonly rooms = new Map<string, RoomRecord>();
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(options?: { ttlMs?: number; now?: () => number }) {
    this.ttlMs = options?.ttlMs ?? 12 * 60 * 60_000; // 12h of inactivity
    this.now = options?.now ?? Date.now;
  }

  create(): CreatedRoom {
    const now = this.now();
    let roomId = generateRoomId();
    for (let attempt = 0; attempt < 3 && this.rooms.has(roomId); attempt += 1) {
      roomId = generateRoomId();
    }
    if (this.rooms.has(roomId)) {
      // 128-bit collision three times in a row is not a thing that happens
      // by accident; refuse loudly instead of silently overwriting.
      throw new Error("room id collision — refusing to overwrite");
    }

    const inviteSecret = generateInviteSecret();
    const recoveryCode = generateRecoveryCode();
    const record: RoomRecord = {
      roomId,
      secretHash: sha256Hex(inviteSecret),
      recoveryHash: sha256Hex(normalizeRecoveryCode(recoveryCode)),
      createdAt: now,
      lastActivityAt: now,
    };
    this.rooms.set(roomId, record);
    return {
      ...record,
      inviteSecret,
      recoveryCode,
      expiresAt: now + this.ttlMs,
    };
  }

  /** Look up without extending activity (M4 join will call touch()). */
  get(roomId: string): RoomRecord | undefined {
    return this.rooms.get(roomId);
  }

  /** Extend the TTL clock — called on meaningful activity (joins, events). */
  touch(roomId: string): void {
    const record = this.rooms.get(roomId);
    if (record) {
      record.lastActivityAt = this.now();
    }
  }

  verifySecret(roomId: string, secret: string): boolean {
    return this.verifyHash(roomId, sha256Hex(secret), "secretHash");
  }

  verifyRecovery(roomId: string, code: string): boolean {
    return this.verifyHash(
      roomId,
      sha256Hex(normalizeRecoveryCode(code)),
      "recoveryHash",
    );
  }

  /** Remove rooms idle beyond the TTL. Returns the removed room IDs. */
  sweep(): string[] {
    const now = this.now();
    const removed: string[] = [];
    for (const [roomId, record] of this.rooms) {
      if (now - record.lastActivityAt > this.ttlMs) {
        this.rooms.delete(roomId);
        removed.push(roomId);
      }
    }
    return removed;
  }

  get size(): number {
    return this.rooms.size;
  }

  private verifyHash(
    roomId: string,
    candidateHashHex: string,
    field: "secretHash" | "recoveryHash",
  ): boolean {
    const record = this.rooms.get(roomId);
    if (!record) return false;
    const stored = Buffer.from(record[field], "hex");
    const candidate = Buffer.from(candidateHashHex, "hex");
    if (stored.length !== candidate.length) return false;
    return timingSafeEqual(stored, candidate);
  }
}
import { createHash, randomBytes } from "node:crypto";

/**
 * Cryptographic identifiers (brief §6, review criteria R2).
 *
 * - roomId: 128-bit, base64url (22 chars). It rides in URLs, so it is not
 *   treated as a secret — but it is still unguessable.
 * - inviteSecret: 256-bit, base64url (43 chars). THE capability: whoever
 *   holds it can claim a free slot (until both slots are taken — owner
 *   decision, invite semantics Option 1). The server stores only its
 *   sha-256 hash.
 * - recoveryCode: 128-bit, hex shown as 4 dash-separated groups of 8.
 *   Creator-only escape hatch when a device loses its stored token (iOS ITP
 *   makes storage loss ROUTINE, not an edge case — R2). Also hash-only on
 *   the server, never logged, never in a URL.
 */
export const ROOM_ID_BYTES = 16;
export const INVITE_SECRET_BYTES = 32;
export const RECOVERY_CODE_BYTES = 16;

export function generateRoomId(): string {
  return randomBytes(ROOM_ID_BYTES).toString("base64url");
}

export function generateInviteSecret(): string {
  return randomBytes(INVITE_SECRET_BYTES).toString("base64url");
}

export function generateRecoveryCode(): string {
  const hex = randomBytes(RECOVERY_CODE_BYTES).toString("hex"); // 32 chars
  return (hex.match(/.{8}/g) ?? [hex]).join("-");
}

/**
 * Recovery codes are human-handled: dashes and spaces are cosmetic, case is
 * irrelevant. Everything is normalized BEFORE hashing/verifying so that
 * "ABCD-1234" and "abcd1234" are the same code.
 */
export function normalizeRecoveryCode(input: string): string {
  return input.replace(/[\s-]/g, "").toLowerCase();
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
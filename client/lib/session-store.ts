/**
 * Session persistence (M4, token-design §6).
 *
 * - sessionToken: localStorage, key cl:session:<roomId>. Survives reloads;
 *   dies with ITP eviction (≈7 days idle) — the recovery flow is designed
 *   as a PRIMARY path, not an edge case.
 * - invite secret: sessionStorage (tab-only), written by the room page's
 *   fragment capture; read/consumed here. NEVER localStorage — the secret
 *   must not outlive the tab, and it must not leak across tabs.
 *
 * All readers are defensive: Safari private mode can throw on access, and
 * a tampered payload must degrade to "no session", never crash the page.
 */

export type SlotId = "A" | "B";

export type StoredSession = {
  token: string;
  slot: SlotId;
};

const sessionKey = (roomId: string) => `cl:session:${roomId}`;
const inviteKey = (roomId: string) => `cl:invite:${roomId}`;
const recoveryKey = (roomId: string) => `cl:recovery:${roomId}`;

// In-memory fallback for browsers where sessionStorage throws (Safari
// private mode / storage disabled). It covers client-side navigation from
// Lobby to the room page, which is the path both secrets normally take.
const memorySecrets = new Map<string, string>();
const memoryRecoveryCodes = new Map<string, string>();

export function readStoredSession(roomId: string): StoredSession | null {
  try {
    const raw = window.localStorage.getItem(sessionKey(roomId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const record = parsed as Record<string, unknown>;
    if (typeof record.token !== "string" || record.token.length === 0) {
      return null;
    }
    if (record.slot !== "A" && record.slot !== "B") return null;
    return { token: record.token, slot: record.slot };
  } catch {
    return null;
  }
}

export function writeStoredSession(
  roomId: string,
  session: StoredSession,
): void {
  try {
    window.localStorage.setItem(sessionKey(roomId), JSON.stringify(session));
  } catch {
    // Storage refused (private mode / ITP). The room still works for this
    // tab; a reload will need the invite link or recovery code instead.
  }
}

export function clearStoredSession(roomId: string): void {
  try {
    window.localStorage.removeItem(sessionKey(roomId));
  } catch {
    // Nothing to do — already unreadable.
  }
}

export function readSecret(roomId: string): string | null {
  try {
    const stored = window.sessionStorage.getItem(inviteKey(roomId));
    if (stored) return stored;
  } catch {
    // Fall through to the in-memory copy.
  }
  return memorySecrets.get(roomId) ?? null;
}

export function writeSecret(roomId: string, secret: string): void {
  memorySecrets.set(roomId, secret);
  try {
    window.sessionStorage.setItem(inviteKey(roomId), secret);
  } catch {
    // Private mode / storage disabled. The in-memory copy still covers
    // client-side navigation; only a page reload loses the invite link.
  }
}

/** Recovery codes take the same tab-only side-channel as the invite secret. */
export function writeRecoveryCode(roomId: string, code: string): void {
  memoryRecoveryCodes.set(roomId, code);
  try {
    window.sessionStorage.setItem(recoveryKey(roomId), code);
  } catch {
    // The in-memory copy covers the Lobby -> room navigation.
  }
}

/** Read and remove the recovery code — it is shown once, then gone. */
export function takeRecoveryCode(roomId: string): string | null {
  let code = memoryRecoveryCodes.get(roomId) ?? null;
  memoryRecoveryCodes.delete(roomId);
  try {
    const stored = window.sessionStorage.getItem(recoveryKey(roomId));
    if (stored) {
      window.sessionStorage.removeItem(recoveryKey(roomId));
      code = stored;
    }
  } catch {
    // The in-memory copy (if any) is returned.
  }
  return code;
}

/**
 * The secret stays in sessionStorage for the TAB's lifetime (M3 semantics:
 * it is what lets the invite card survive a soft reload) and dies with the
 * tab. It is never copied to localStorage and never re-enters the URL.
 */
export function consumeSecret(roomId: string): void {
  memorySecrets.delete(roomId);
  try {
    window.sessionStorage.removeItem(inviteKey(roomId));
  } catch {
    // Nothing to do.
  }
}
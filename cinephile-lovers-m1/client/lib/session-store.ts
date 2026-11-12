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
    return window.sessionStorage.getItem(inviteKey(roomId));
  } catch {
    return null;
  }
}

/**
 * The secret stays in sessionStorage for the TAB's lifetime (M3 semantics:
 * it is what lets the invite card survive a soft reload) and dies with the
 * tab. It is never copied to localStorage and never re-enters the URL.
 */
export function consumeSecret(roomId: string): void {
  try {
    window.sessionStorage.removeItem(inviteKey(roomId));
  } catch {
    // Nothing to do.
  }
}
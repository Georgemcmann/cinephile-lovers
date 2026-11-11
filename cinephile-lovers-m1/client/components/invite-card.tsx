"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import { Check, Copy, KeyRound } from "lucide-react";

type InviteCardProps = {
  roomId: string;
  inviteSecret: string;
  /** Present ONLY right after creation; shown once, then gone (R2). */
  recoveryCode: string | null;
};

/**
 * window.location.origin is a browser-only value: read through
 * useSyncExternalStore so SSR and hydration stay consistent (server
 * snapshot is the empty string; the client snapshot arrives right after
 * hydration). No effects, no cascading setState.
 */
const subscribeToNothing = () => () => {};
function getOrigin(): string {
  return window.location.origin;
}
function getEmptyOrigin(): string {
  return "";
}

/**
 * InviteCard — the M3 invite surface.
 *
 * - The invite link is RECONSTRUCTED from memory (origin + path + secret
 *   fragment) on demand. The address bar itself is scrubbed by the room
 *   page the moment the secret is captured, so the secret does not sit in
 *   the URL bar for the whole session.
 * - Clipboard uses the async API with a graceful fallback: if it fails
 *   (non-secure context, permission denied), the link input is focused and
 *   selected for a manual copy. Nothing is ever lost to a clipboard quirk.
 * - The recovery code is shown exactly once with an explicit save step; it
 *   is NOT stored anywhere client-side afterwards (R2: recovery is a
 *   primary path once iOS evicts storage).
 */
export function InviteCard({
  roomId,
  inviteSecret,
  recoveryCode,
}: InviteCardProps) {
  const origin = useSyncExternalStore(
    subscribeToNothing,
    getOrigin,
    getEmptyOrigin,
  );
  const link = origin ? `${origin}/room/${roomId}#${inviteSecret}` : "";
  const [copied, setCopied] = useState(false);
  const [manualHint, setManualHint] = useState(false);
  const linkInputRef = useRef<HTMLInputElement | null>(null);
  const [codeCopied, setCodeCopied] = useState(false);
  const [recoveryDismissed, setRecoveryDismissed] = useState(false);

  async function copyLink(): Promise<void> {
    if (!navigator.clipboard) {
      setManualHint(true);
      linkInputRef.current?.focus();
      linkInputRef.current?.select();
      return;
    }
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setManualHint(false);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setManualHint(true);
      linkInputRef.current?.focus();
      linkInputRef.current?.select();
    }
  }

  async function copyRecoveryCode(): Promise<void> {
    if (!recoveryCode || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(recoveryCode);
      setCodeCopied(true);
      window.setTimeout(() => setCodeCopied(false), 2000);
    } catch {
      // The code is fully visible in the card; a failed copy is harmless.
    }
  }

  return (
    <section
      className="flex flex-col gap-3 rounded-2xl border border-line bg-panel p-4"
      aria-label="Invite"
    >
      <p className="text-sm font-medium">Invite your partner</p>

      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          ref={linkInputRef}
          type="text"
          readOnly
          value={link}
          aria-label="Invite link"
          onFocus={(event) => event.currentTarget.select()}
          className="min-w-0 flex-1 rounded-xl border border-line bg-base px-3 py-2 font-mono text-xs text-muted outline-none focus:border-accent"
        />
        <button
          type="button"
          onClick={copyLink}
          className="inline-flex min-h-11 flex-none items-center justify-center gap-2 rounded-xl bg-btn-red px-5 text-sm font-semibold text-ink transition-colors hover:bg-btn-red-deep"
        >
          {copied ? (
            <>
              <Check size={16} aria-hidden="true" />
              Copied
            </>
          ) : (
            <>
              <Copy size={16} aria-hidden="true" />
              Copy link
            </>
          )}
        </button>
      </div>

      {manualHint ? (
        <p className="text-xs text-soft" role="status">
          Automatic copy was blocked — the link is selected above, press
          Ctrl-C / long-press to copy it.
        </p>
      ) : null}

      <p className="text-xs leading-relaxed text-muted">
        Send this link to exactly one person. It is also YOUR key to the room,
        so keep it. If the room is abandoned long enough it expires; creating
        a new one takes seconds.
      </p>

      {recoveryCode && !recoveryDismissed ? (
        <div className="flex flex-col gap-2 rounded-xl border border-line bg-elevated p-3">
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-soft">
            <KeyRound size={14} aria-hidden="true" />
            Your recovery code
          </p>
          <p className="break-all font-mono text-sm">{recoveryCode}</p>
          <p className="text-xs leading-relaxed text-muted">
            Save this somewhere private (Notes, password manager). It is shown
            only once and it is the only way back into this room if this
            device loses its key.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={copyRecoveryCode}
              className="inline-flex min-h-11 items-center gap-2 rounded-full border border-line px-4 text-sm text-ink transition-colors hover:bg-elevated"
            >
              {codeCopied ? (
                <>
                  <Check size={14} aria-hidden="true" />
                  Copied
                </>
              ) : (
                <>
                  <Copy size={14} aria-hidden="true" />
                  Copy code
                </>
              )}
            </button>
            <button
              type="button"
              onClick={() => setRecoveryDismissed(true)}
              className="inline-flex min-h-11 items-center rounded-full px-4 text-sm text-muted transition-colors hover:text-ink"
            >
              I saved it
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
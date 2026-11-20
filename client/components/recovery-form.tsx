"use client";

import { useState } from "react";
import { KeyRound } from "lucide-react";

type RecoveryFormProps = {
  busy: boolean;
  onSubmit: (code: string) => void;
  error: string | null;
};

/**
 * Creator recovery entry (M4, token-design §3/§4): shown when this device
 * holds neither the invite secret nor a session token. The code was shown
 * exactly once at creation — this is the only place it is ever typed.
 */
export function RecoveryForm({ busy, onSubmit, error }: RecoveryFormProps) {
  const [code, setCode] = useState("");

  return (
    <section
      className="flex flex-col gap-3 rounded-2xl border border-line bg-panel p-4"
      aria-label="Recovery"
    >
      <p className="flex items-center gap-2 text-sm font-medium">
        <KeyRound size={16} aria-hidden="true" />
        Recover the creator seat
      </p>
      <p className="text-xs leading-relaxed text-muted">
        If you are the one who created this room, paste the recovery code you
        saved when the room was created. It takes your seat back without
        disturbing your partner.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const trimmed = code.trim();
          if (trimmed && !busy) {
            onSubmit(trimmed);
          }
        }}
        className="flex flex-col gap-2 sm:flex-row"
      >
        <input
          type="text"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          placeholder="xxxxxxxx-xxxxxxxx-xxxxxxxx-xxxxxxxx"
          aria-label="Recovery code"
          autoComplete="off"
          spellCheck={false}
          className="min-w-0 flex-1 rounded-xl border border-line bg-base px-3 py-2 font-mono text-xs outline-none focus:border-accent"
        />
        <button
          type="submit"
          disabled={busy || code.trim().length === 0}
          className="inline-flex min-h-11 flex-none items-center justify-center rounded-xl bg-btn-red px-5 text-sm font-semibold text-ink transition-colors hover:bg-btn-red-deep disabled:opacity-50"
        >
          {busy ? "Recovering…" : "Recover"}
        </button>
      </form>
      {error ? (
        <p className="text-sm text-soft" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
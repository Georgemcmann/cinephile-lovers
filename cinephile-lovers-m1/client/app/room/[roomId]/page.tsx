"use client";

import { useEffect, useSyncExternalStore } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

import { FilePicker } from "@/components/file-picker";
import { InviteCard } from "@/components/invite-card";
import { NodeBadge } from "@/components/node-badge";
import { PlayerControls } from "@/components/player-controls";

const inviteKey = (roomId: string) => `cl:invite:${roomId}`;
const recoveryKey = (roomId: string) => `cl:recovery:${roomId}`;

// base64url room ids are 22 chars; the shape check is deliberately loose —
// the server is the authority on whether the room exists (M4 join).
const ROOM_ID_SHAPE = /^[A-Za-z0-9_-]{10,64}$/;

/**
 * The invite-secret capture lives OUTSIDE React, in a tiny module-level
 * store, because it coordinates three browser systems (URL fragment,
 * sessionStorage, history) and must be idempotent under StrictMode
 * remounts. React subscribes with useSyncExternalStore — no setState in
 * effects, no hydration mismatch (the server snapshot is EMPTY_CAPTURE).
 */
type CaptureState = {
  done: boolean;
  secret: string | null;
  recovery: string | null;
};

const EMPTY_CAPTURE: CaptureState = { done: false, secret: null, recovery: null };
const captureStates = new Map<string, CaptureState>();
const listeners = new Set<() => void>();

function captureFor(roomId: string): CaptureState {
  const existing = captureStates.get(roomId);
  if (existing) return existing;
  // NEVER store EMPTY_CAPTURE itself: runCapture REPLACES the map entry
  // with a new object (immutable snapshots — useSyncExternalStore compares
  // with Object.is, and an in-place mutation would be invisible to React).
  const fresh: CaptureState = {
    done: false,
    secret: null,
    recovery: null,
  };
  captureStates.set(roomId, fresh);
  return fresh;
}

function subscribeToCapture(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function runCapture(roomId: string): void {
  const state = captureFor(roomId);
  if (state.done) return; // idempotent under StrictMode double-mount

  // 1) Secret arrives in the URL fragment (brief §6): stash it for THIS tab
  // only, then scrub the address bar immediately — the secret never sits in
  // the URL for the rest of the session (owner directive, R2).
  const fromHash = window.location.hash.replace(/^#/, "");
  if (fromHash) {
    sessionStorage.setItem(inviteKey(roomId), fromHash);
    window.history.replaceState(
      null,
      "",
      window.location.pathname + window.location.search,
    );
  }

  // 2) Same-tab reload: sessionStorage restores the key. A NEW tab does not
  // inherit it — the invite link is the only transport for the secret.
  const secret = fromHash || sessionStorage.getItem(inviteKey(roomId));

  // 3) The recovery code takes the sessionStorage side-channel from the
  // lobby (post-creation) and is consumed here: shown exactly once, never
  // stored client-side afterwards.
  const recovery = sessionStorage.getItem(recoveryKey(roomId));
  if (recovery) {
    sessionStorage.removeItem(recoveryKey(roomId));
  }

  // REPLACE (not mutate) so subscribers see a new snapshot identity.
  captureStates.set(roomId, { done: true, secret, recovery });
  for (const listener of listeners) listener();
}

/**
 * Watch room — M3 adds the real route shape /room/<roomId> and the invite
 * lifecycle; the M2 player lives unchanged below.
 */
export default function WatchRoomPage() {
  const params = useParams<{ roomId: string }>();
  const roomId = typeof params.roomId === "string" ? params.roomId : "";
  const validId = ROOM_ID_SHAPE.test(roomId);

  const capture = useSyncExternalStore(
    subscribeToCapture,
    () => captureFor(roomId),
    () => EMPTY_CAPTURE,
  );

  useEffect(() => {
    if (validId) {
      runCapture(roomId);
    }
  }, [roomId, validId]);

  if (!validId) {
    return (
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-6 py-10">
        <header>
          <h1 className="text-2xl font-semibold">Watch room</h1>
        </header>
        <section
          className="flex flex-col gap-2 rounded-2xl border border-line bg-panel p-4"
          aria-label="Broken link"
        >
          <p className="text-sm text-soft">
            This room link does not look right.
          </p>
          <p className="text-xs leading-relaxed text-muted">
            Ask for a fresh invite link — the room key travels inside the
            link and cannot be reconstructed.
          </p>
        </section>
        <nav className="flex flex-col gap-3">
          <Link
            href="/lobby"
            className="inline-flex min-h-11 items-center justify-center rounded-full px-6 text-sm text-muted transition-colors hover:text-ink"
          >
            Back to lobby
          </Link>
        </nav>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-5 px-6 py-8">
      <header>
        <h1 className="text-2xl font-semibold">Watch room</h1>
        <p className="mt-1 text-sm text-muted">
          Private screening for two. Live sync arrives in M4.
        </p>
      </header>

      {capture.done && capture.secret ? (
        <InviteCard
          roomId={roomId}
          inviteSecret={capture.secret}
          recoveryCode={capture.recovery}
        />
      ) : null}

      {capture.done && !capture.secret ? (
        <section
          className="flex flex-col gap-2 rounded-2xl border border-line bg-panel p-4"
          aria-label="Missing key"
        >
          <p className="text-sm text-soft">
            This device does not hold the key for this room.
          </p>
          <p className="text-xs leading-relaxed text-muted">
            Open the invite link you were sent — the key is the part after
            the # in the link. Recovering access without the link arrives in
            M4.
          </p>
        </section>
      ) : null}

      <NodeBadge label="watch" />
      <FilePicker />
      <PlayerControls />

      <nav className="flex flex-col gap-3">
        <Link
          href="/lobby"
          className="inline-flex min-h-11 items-center justify-center rounded-full px-6 text-sm text-muted transition-colors hover:text-ink"
        >
          Back to lobby
        </Link>
      </nav>
    </main>
  );
}
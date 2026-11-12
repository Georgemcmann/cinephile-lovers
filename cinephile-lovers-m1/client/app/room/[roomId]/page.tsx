"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { Socket } from "socket.io-client";

import { ChatPanel } from "@/components/chat-panel";
import { FilePicker } from "@/components/file-picker";
import { InviteCard } from "@/components/invite-card";
import { NodeBadge } from "@/components/node-badge";
import { PartnerPanel } from "@/components/partner-panel";
import { PlayerControls, formatTime } from "@/components/player-controls";
import { RecoveryForm } from "@/components/recovery-form";
import { usePersistentVideo } from "@/components/persistent-layer";
import {
  announceFile,
  createRoomSocket,
  helloRoom,
  joinRoom,
  recoverRoom,
  resetSlot,
  sendChat,
  upgradeAuth,
  type ChatMessage,
  type PlaybackAnchor,
  type Role,
  type SlotId,
  type Snapshot,
} from "@/lib/room-socket";
import {
  clearStoredSession,
  readStoredSession,
  writeStoredSession,
} from "@/lib/session-store";
import {
  createSyncEngine,
  EMPTY_SYNC_UI,
  type SyncEngine,
  type SyncUiState,
} from "@/lib/sync-engine";

const inviteKey = (roomId: string) => `cl:invite:${roomId}`;
const recoveryKey = (roomId: string) => `cl:recovery:${roomId}`;

// base64url room ids are 22 chars; the shape check is deliberately loose —
// the server is the authority on whether the room exists.
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
 * Watch-room phase machine (M4):
 * - connecting  — socket up, membership pending
 * - joined      — seat bound; presence, chat, file check live
 * - no-key      — this tab holds neither token nor (working) secret:
 *                 invite-link hint + creator recovery form
 * - replaced    — a newer session took this seat; dead-end, manual takeover
 * - terminated  — the creator freed this seat; stored token cleared
 * - dead        — room/server gone (single-instance honesty, R8)
 */
type Phase = "connecting" | "joined" | "no-key" | "replaced" | "terminated" | "dead";

function describeJoinError(error: string): string {
  switch (error) {
    case "room_full":
      return "The room already has two people in it. The creator can free a seat from their side.";
    case "invalid_invite":
      return "This invite link is not valid — the room may have expired.";
    case "rate_limited":
      return "Too many attempts right now. Wait a minute and try again.";
    case "timeout":
      return "The server did not answer. It may be waking up — try again in a minute.";
    default:
      return "The room refused the join. Try the link again.";
  }
}

function describeRecoveryError(error: string): string {
  switch (error) {
    case "invalid_recovery":
      return "That code does not match this room.";
    case "rate_limited":
      return "Too many attempts. Wait a minute before trying again.";
    case "timeout":
      return "The server did not answer. Try again in a moment.";
    default:
      return "Recovery failed. Check the code and try again.";
  }
}

const NO_SLOTS: Snapshot["slots"] = {
  A: { occupied: false, online: false },
  B: { occupied: false, online: false },
};
const NO_FILES: Snapshot["files"] = { A: null, B: null };

export default function WatchRoomPage() {
  const params = useParams<{ roomId: string }>();
  const roomId = typeof params.roomId === "string" ? params.roomId : "";
  const validId = ROOM_ID_SHAPE.test(roomId);

  const capture = useSyncExternalStore(
    subscribeToCapture,
    () => captureFor(roomId),
    () => EMPTY_CAPTURE,
  );

  const { state, videoRef, setIntentSink, applyRemote } = usePersistentVideo();

  const [phase, setPhase] = useState<Phase>("connecting");
  const [connected, setConnected] = useState(false);
  const [you, setYou] = useState<{ slot: SlotId; role: Role } | null>(null);
  const [slots, setSlots] = useState<Snapshot["slots"]>(NO_SLOTS);
  const [files, setFiles] = useState<Snapshot["files"]>(NO_FILES);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [syncUi, setSyncUi] = useState<SyncUiState>(EMPTY_SYNC_UI);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [recoverBusy, setRecoverBusy] = useState(false);
  const [recoverError, setRecoverError] = useState<string | null>(null);
  const [resetBusy, setResetBusy] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  const socketRef = useRef<Socket | null>(null);
  const engineRef = useRef<SyncEngine | null>(null);
  // The newest snapshot's playback anchor — created BEFORE the sync engine
  // (join/hello acks land first), handed to the engine at creation.
  const lastSnapshotRef = useRef<PlaybackAnchor | null>(null);
  // The secret-join is attempted at most ONCE per mount: reconnects must
  // never re-burn the join rate limit on a page that is stuck in no-key.
  const joinAttemptedRef = useRef(false);

  function stopReconnecting(socket: Socket): void {
    socket.io.opts.reconnection = false;
    socket.disconnect();
  }

  useEffect(() => {
    if (!validId) return;

    // Capture the fragment/secret BEFORE any socket work: a rejected
    // handshake (bad_session) must never be able to lose the invite link.
    if (!captureFor(roomId).done) runCapture(roomId);

    const socket = createRoomSocket(roomId, readStoredSession(roomId));
    socketRef.current = socket;
    let disposed = false;
    // Set when the server refuses the stored token. The invite secret (if
    // this tab still holds one) is then the only approved way back in.
    let sessionRejected = false;

    async function afterConnect(): Promise<void> {
      if (disposed) return;

      const stored = readStoredSession(roomId);
      if (stored) {
        const ack = await helloRoom(socket, roomId);
        if (disposed) return;
        if (ack.ok) {
          setYou(ack.you);
          setSlots(ack.snapshot.slots);
          setFiles(ack.snapshot.files);
          setChat(ack.snapshot.chat);
          lastSnapshotRef.current = ack.snapshot.playback;
          setPhase("joined");
        } else if (ack.error === "room_gone" || ack.error === "timeout") {
          stopReconnecting(socket);
          setPhase("dead");
        } else {
          clearStoredSession(roomId);
          setPhase("no-key");
        }
        return;
      }

      if (joinAttemptedRef.current) {
        // Already tried (and failed) with the secret this mount; stay on
        // the no-key screen instead of re-spamming room:join.
        setPhase((current) => (current === "joined" ? current : "no-key"));
        return;
      }
      joinAttemptedRef.current = true;

      const secret = captureFor(roomId).secret;
      if (!secret) {
        setPhase("no-key");
        return;
      }
      const ack = await joinRoom(socket, roomId, secret);
      if (disposed) return;
      if (ack.ok) {
        writeStoredSession(roomId, { token: ack.token, slot: ack.slot });
        upgradeAuth(socket, roomId, ack.token);
        setYou({ slot: ack.slot, role: ack.role });
        setSlots(ack.snapshot.slots);
        setFiles(ack.snapshot.files);
        setChat(ack.snapshot.chat);
        lastSnapshotRef.current = ack.snapshot.playback;
        setPhase("joined");
      } else if (ack.error === "invalid_invite" && sessionRejected) {
        // The token was refused AND the invite no longer opens anything:
        // the room is gone (single-instance restart / TTL sweep), not a
        // missing-key problem.
        setPhase("dead");
      } else {
        setJoinError(describeJoinError(ack.error));
        setPhase("no-key");
      }
    }

    socket.on("connect", () => {
      if (disposed) return;
      setConnected(true);
      void afterConnect();
    });
    socket.on("disconnect", () => {
      if (!disposed) setConnected(false);
    });
    socket.on("connect_error", (err: Error) => {
      if (disposed) return;
      if (err.message === "bad_session") {
        // The stored token no longer resumes anything (room restarted, or
        // the seat was freed/recovered elsewhere). Drop the credential and
        // retry WITHOUT auth — afterConnect will then use the invite secret
        // if this tab still holds it. Never dead-end a tab that has a usable
        // invite link.
        sessionRejected = true;
        clearStoredSession(roomId);
        socket.auth = { roomId };
        // A middleware CONNECT_ERROR destroys the socket's subscriptions,
        // so the Manager's own retry would never re-deliver "connect" to
        // this socket. Re-open it explicitly once the failed cycle settles.
        setTimeout(() => {
          if (!disposed) socket.connect();
        }, 50);
      }
    });
    socket.on("room:state", (payload: { slots: Snapshot["slots"] }) => {
      if (!disposed) setSlots(payload.slots);
    });
    socket.on("chat:message", (message: ChatMessage) => {
      if (!disposed) setChat((previous) => [...previous, message]);
    });
    socket.on("file:state", (payload: { files: Snapshot["files"] }) => {
      if (!disposed) setFiles(payload.files);
    });
    socket.on("session:replaced", () => {
      if (disposed) return;
      // NEVER auto-reconnect here: the newest tab owns the token and both
      // tabs hold it — reconnecting would start a takeover ping-pong
      // (docs/socket-events.md §5).
      stopReconnecting(socket);
      setPhase("replaced");
    });
    socket.on("session:terminated", () => {
      if (disposed) return;
      clearStoredSession(roomId);
      stopReconnecting(socket);
      setPhase("terminated");
    });

    return () => {
      disposed = true;
      socket.disconnect();
      socketRef.current = null;
    };
  }, [roomId, validId]);

  // Announce local file METADATA whenever a (new) file becomes ready —
  // the input for the same-file check. Bytes never leave the device.
  const announcedRef = useRef("");
  useEffect(() => {
    if (phase !== "joined" || !connected || !you) return;
    if (state.status !== "ready" || !state.fileName || !state.fileSize || state.duration <= 0) {
      return;
    }
    const key = `${state.fileName}|${state.fileSize}|${state.duration}`;
    if (announcedRef.current === key) return;
    const socket = socketRef.current;
    if (!socket) return;
    announcedRef.current = key;
    announceFile(socket, {
      name: state.fileName,
      sizeBytes: state.fileSize,
      durationSeconds: state.duration,
    });
  }, [phase, connected, you, state]);

  /**
   * M5: the sync engine lives exactly as long as the joined session. It
   * registers itself as the persistent layer's intent sink, applies the
   * newest snapshot anchor, and feeds the indicators above. Engine methods
   * are stable per instance; the socket is room-scoped.
   */
  useEffect(() => {
    if (phase !== "joined" || !you) return;
    const socket = socketRef.current;
    if (!socket) return;

    const engine = createSyncEngine({
      socket,
      slot: you.slot,
      getVideo: () => videoRef.current,
      setIntentSink,
      applyRemote,
    });
    engineRef.current = engine;
    const unsubscribe = engine.subscribe(() => setSyncUi(engine.getUiState()));
    socket.on("sync:command", engine.handleSyncCommand);
    socket.on("sync:scrub", engine.handleScrub);
    socket.on("sync:status", engine.handleStatus);
    engine.applyAnchorFromSnapshot(lastSnapshotRef.current);

    return () => {
      socket.off("sync:command", engine.handleSyncCommand);
      socket.off("sync:scrub", engine.handleScrub);
      socket.off("sync:status", engine.handleStatus);
      unsubscribe();
      engine.destroy();
      engineRef.current = null;
    };
  }, [phase, you, setIntentSink, applyRemote, videoRef]);

  async function handleRecovery(code: string): Promise<void> {
    const socket = socketRef.current;
    if (!socket || recoverBusy) return;
    setRecoverBusy(true);
    setRecoverError(null);
    const ack = await recoverRoom(socket, roomId, code);
    if (ack.ok) {
      writeStoredSession(roomId, { token: ack.token, slot: ack.slot });
      upgradeAuth(socket, roomId, ack.token);
      setYou({ slot: ack.slot, role: ack.role });
      setSlots(ack.snapshot.slots);
      setFiles(ack.snapshot.files);
      setChat(ack.snapshot.chat);
      lastSnapshotRef.current = ack.snapshot.playback;
      setPhase("joined");
    } else {
      setRecoverError(describeRecoveryError(ack.error));
    }
    setRecoverBusy(false);
  }

  async function handleReset(): Promise<void> {
    const socket = socketRef.current;
    if (!socket || resetBusy) return;
    setResetBusy(true);
    setResetError(null);
    const ack = await resetSlot(socket, roomId);
    if (!ack.ok) {
      setResetError(
        ack.error === "rate_limited"
          ? "Too many resets right now — wait a minute."
          : "The seat could not be freed.",
      );
    }
    setResetBusy(false);
  }

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
          Private screening for two. Playback stays in sync.
        </p>
      </header>

      {phase === "joined" && you ? (
        <>
          <p className="flex items-center gap-2 text-xs text-muted">
            <span
              className={`inline-block h-2 w-2 rounded-full ${connected ? "bg-btn-red" : "bg-muted"}`}
              aria-hidden="true"
            />
            {connected
              ? "Connected"
              : "Reconnecting… (the room keeps your seat)"}
          </p>
          {syncUi.partnerScrubbing ? (
            <p className="text-xs text-muted" role="status">
              Partner is seeking · {formatTime(syncUi.partnerScrubPosition ?? 0)}
            </p>
          ) : null}
          {syncUi.partnerBuffering ? (
            <p className="text-xs text-muted" role="status">
              Partner is buffering…
            </p>
          ) : null}
          {syncUi.partnerLostNotice ? (
            <p className="text-sm text-soft" role="alert">
              The partner lost connection — playback was paused. It resumes
              when they are back and either of you presses play.
            </p>
          ) : null}
          {syncUi.resyncFlash ? (
            <p className="text-xs text-muted" role="status">
              Re-synced to the shared position.
            </p>
          ) : null}
          <PartnerPanel
            youSlot={you.slot}
            youRole={you.role}
            slots={slots}
            files={files}
            canReset={you.role === "creator"}
            onReset={handleReset}
            resetBusy={resetBusy}
          />
          {resetError ? (
            <p className="text-sm text-soft" role="alert">
              {resetError}
            </p>
          ) : null}
        </>
      ) : null}

      {phase === "connecting" ? (
        <p className="text-sm text-muted">Knocking on the room door…</p>
      ) : null}

      {phase === "no-key" ? (
        <>
          {joinError ? (
            <p className="text-sm text-soft" role="alert">
              {joinError}
            </p>
          ) : null}
          <section
            className="flex flex-col gap-2 rounded-2xl border border-line bg-panel p-4"
            aria-label="Missing key"
          >
            <p className="text-sm text-soft">
              This device does not hold the key for this room.
            </p>
            <p className="text-xs leading-relaxed text-muted">
              Open the invite link you were sent — the key is the part after
              the # in the link. If you created the room, the recovery code
              below is your way back.
            </p>
          </section>
          <RecoveryForm
            busy={recoverBusy}
            error={recoverError}
            onSubmit={handleRecovery}
          />
        </>
      ) : null}

      {phase === "replaced" ? (
        <section
          className="flex flex-col gap-3 rounded-2xl border border-line bg-panel p-4"
          aria-label="Opened elsewhere"
        >
          <p className="text-sm font-medium">
            This room was opened in another tab or device.
          </p>
          <p className="text-xs leading-relaxed text-muted">
            Only one device can hold a seat. Nothing was deleted — you can
            take the seat back here, which closes it there.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex min-h-11 items-center justify-center self-start rounded-full bg-btn-red px-6 text-sm font-semibold text-ink transition-colors hover:bg-btn-red-deep"
          >
            Take over in this tab
          </button>
        </section>
      ) : null}

      {phase === "terminated" ? (
        <section
          className="flex flex-col gap-2 rounded-2xl border border-line bg-panel p-4"
          aria-label="Removed"
        >
          <p className="text-sm font-medium">
            Your seat in this room was freed by the creator.
          </p>
          <p className="text-xs leading-relaxed text-muted">
            Re-open the invite link to come back — the seat is open now.
          </p>
        </section>
      ) : null}

      {phase === "dead" ? (
        <section
          className="flex flex-col gap-2 rounded-2xl border border-line bg-panel p-4"
          aria-label="Room lost"
        >
          <p className="text-sm font-medium">The room is gone.</p>
          <p className="text-xs leading-relaxed text-muted">
            Rooms live in one server&apos;s memory — a restart ends every
            room, and nothing can bring this one back. Create a new one; it
            takes seconds.
          </p>
          <Link
            href="/lobby"
            className="inline-flex min-h-11 items-center justify-center self-start rounded-full bg-btn-red px-6 text-sm font-semibold text-ink transition-colors hover:bg-btn-red-deep"
          >
            Create a new room
          </Link>
        </section>
      ) : null}

      {capture.done && capture.secret && phase === "joined" ? (
        <InviteCard
          roomId={roomId}
          inviteSecret={capture.secret}
          recoveryCode={capture.recovery}
        />
      ) : null}

      <NodeBadge label="watch" />
      <FilePicker />
      <PlayerControls
        onScrub={(position) => engineRef.current?.reportScrub(position)}
        onScrubStart={() => engineRef.current?.setScrubbing(true)}
        onScrubEnd={() => engineRef.current?.setScrubbing(false)}
      />

      {phase === "joined" && you ? (
        <ChatPanel
          messages={chat}
          youSlot={you.slot}
          disabled={!connected}
          onSend={(text) => {
            const socket = socketRef.current;
            if (socket) {
              sendChat(socket, text);
            }
          }}
        />
      ) : null}

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
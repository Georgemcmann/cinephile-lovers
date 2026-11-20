"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { usePathname } from "next/navigation";

import { ResumeOverlay } from "./resume-overlay";

/**
 * PersistentLayer — the one client layer that never unmounts during a
 * session (brief §5). It owns the <video> element so that navigating between
 * Lobby and Watch Room can never recreate it.
 *
 * M2 adds the local-file player contract:
 * - The element starts with NO src. A movie enters only through
 *   loadLocalFile(), which MUST be called synchronously inside a user-gesture
 *   handler (the file picker's change event). src swap + load() + play() all
 *   happen inside that one gesture — this is the re-priming rule (review
 *   criteria R1): the element's gesture unlock is only valid for media loaded
 *   within the same user gesture. Nothing may await between the gesture and
 *   play() — no state round-trips, no async work.
 * - All playback commands (play/pause/seek/mute/fullscreen) go through this
 *   layer; the controls never touch the element directly. One writer today;
 *   the M5 sync engine plugs in at exactly this seam.
 * - UI state is derived from element-level events (timeupdate, play, pause,
 *   waiting, volumechange, ...), never from command success — the shape the
 *   sync engine needs (native fullscreen stays in sync, review R1).
 *
 * M5 plugs the sync engine in at this seam:
 * - INTENT SINK: element events that are NOT consumed by an expectation are
 *   USER intent and are handed to the sink (the sync engine emits them to
 *   the server). This is the R1 rule "sync listens to element-level events"
 *   made concrete — buttons, native controls and overlay taps all behave
 *   identically because everything funnels through element events.
 * - EXPECTED-ACTION RECORDS: every remote command (and drift correction)
 *   registers what it is about to do BEFORE touching the element; the
 *   resulting element event is consumed instead of re-emitted as intent.
 *   Records expire (echo suppression with an expiry window, review R3), so
 *   a lost broadcast cannot suppress future real intent forever.
 * - THE R3 COMPOSITION RULE (scrub + suppression): the FINAL seeked event
 *   after a commit-on-release scrub can never be swallowed — it is either
 *   consumed by a fresh expectation or emitted as user intent; no time
 *   window can drop it.
 * - REMOTE play() ON AN UN-PRIMED ELEMENT rejects (autoplay policy). The
 *   rejected play expectation is then EXTENDED (not deleted): the tap on the
 *   resume overlay completes the REMOTE command instead of re-emitting it
 *   as fresh user intent (which would yank the partner backwards).
 */

type Phase = "landing" | "lobby" | "watch";

export type PlayerStatus = "idle" | "loading" | "ready" | "error";

export type PlayerState = {
  status: PlayerStatus;
  fileName: string | null;
  fileSize: number | null;
  playing: boolean;
  buffering: boolean;
  ended: boolean;
  currentTime: number;
  duration: number;
  muted: boolean;
  /** A play() call was rejected (autoplay policy) — show the tap-to-resume overlay. */
  resumeNeeded: boolean;
  error: string | null;
};

// --- M5 intent plumbing -----------------------------------------------------

export type PlayerIntentKind = "play" | "pause" | "seek";

/** One playback intent, derived from element events. `position` is the
 *  element position at event time (seek target for seeks). */
export type PlayerIntent = {
  kind: PlayerIntentKind;
  position: number;
};

/** Receives every UNMATCHED (user) intent. The sync engine registers itself. */
export type PlayerIntentSink = (intent: PlayerIntent) => void;

/** How long an expectation may suppress matching element events. */
const EXPECT_TTL_MS = {
  play: 3_000,
  pause: 3_000,
  seek: 5_000,
} as const;

/** A rejected remote play() stays completable by the overlay tap for this long. */
const REMOTE_PLAY_REJECTED_TTL_MS = 30_000;

/** Seek expectations match the event position within this tolerance. */
const SEEK_MATCH_TOLERANCE_S = 0.5;

type ExpectedRecord = {
  kind: PlayerIntentKind;
  /** Seeks match on |event - expected| <= tolerance; play/pause on kind. */
  position: number | null;
  expiresAt: number;
};

type PersistentContextValue = {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  nodeId: string | null;
  state: PlayerState;
  /** Call ONLY from inside a user-gesture handler (file input change). */
  loadLocalFile: (file: File) => void;
  togglePlay: () => void;
  seek: (time: number) => void;
  toggleMuted: () => void;
  enterFullscreen: () => void;
  canEnterFullscreen: boolean;
  /** M5 — register the (single) receiver of unmatched user intents. */
  setIntentSink: (sink: PlayerIntentSink | null) => void;
  /** M5 — expect an element event soon; it will not count as user intent. */
  expectIntent: (kind: PlayerIntentKind, position: number | null) => void;
  /** M5 — apply a REMOTE (or engine-internal) command through the one writer. */
  applyRemote: (intent: PlayerIntent) => void;
};

const INITIAL_STATE: PlayerState = {
  status: "idle",
  fileName: null,
  fileSize: null,
  playing: false,
  buffering: false,
  ended: false,
  currentTime: 0,
  duration: 0,
  muted: false,
  resumeNeeded: false,
  error: null,
};

function noop(): void {}

const PersistentContext = createContext<PersistentContextValue>({
  videoRef: { current: null },
  nodeId: null,
  state: INITIAL_STATE,
  loadLocalFile: noop,
  togglePlay: noop,
  seek: noop,
  toggleMuted: noop,
  enterFullscreen: noop,
  canEnterFullscreen: false,
  setIntentSink: noop,
  expectIntent: noop,
  applyRemote: noop,
});

export function usePersistentVideo(): PersistentContextValue {
  return useContext(PersistentContext);
}

// iPhone Safari only exposes native fullscreen on the video element itself
// (webkitEnterFullscreen); the TS DOM lib does not know it.
type VideoWithIOSFullscreen = HTMLVideoElement & {
  webkitEnterFullscreen?: () => void;
};

const MEDIA_ERROR_TEXT: Record<number, string> = {
  1: "Playback was interrupted. Try playing the file again.",
  2: "The file could not be read. Re-select it and try again.",
  3: "The file is broken or uses codecs this browser cannot decode.",
  4: "This format cannot be played here. iPhone Safari needs H.264 video + AAC audio in an MP4 container.",
};

const MEDIA_ERROR_FALLBACK =
  "The file could not be played. Re-select it and try again.";

function phaseFromPathname(pathname: string | null): Phase {
  if (pathname?.startsWith("/room")) return "watch";
  if (pathname?.startsWith("/lobby")) return "lobby";
  return "landing";
}

export function PersistentLayer({ children }: { children: React.ReactNode }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const pathname = usePathname();
  const [nodeId, setNodeId] = useState<string | null>(null);
  const [canEnterFullscreen, setCanEnterFullscreen] = useState(false);
  const [state, setState] = useState<PlayerState>(INITIAL_STATE);

  // M5: the intent sink and the expected-action records live in refs —
  // they are coordination state for non-React systems (element events),
  // never render inputs.
  const sinkRef = useRef<PlayerIntentSink | null>(null);
  const expectedRef = useRef<ExpectedRecord[]>([]);

  const patch = useCallback((partial: Partial<PlayerState>) => {
    setState((prev) => ({ ...prev, ...partial }));
  }, []);

  const expectIntent = useCallback(
    (kind: PlayerIntentKind, position: number | null) => {
      const ttl = EXPECT_TTL_MS[kind];
      expectedRef.current.push({
        kind,
        position,
        expiresAt: Date.now() + ttl,
      });
    },
    [],
  );

  /** Consume the oldest matching non-expired expectation, if any. */
  const consumeExpected = useCallback(
    (kind: PlayerIntentKind, position: number): boolean => {
      const now = Date.now();
      const records = expectedRef.current;
      const index = records.findIndex(
        (record) =>
          record.kind === kind &&
          record.expiresAt > now &&
          (record.position === null ||
            kind !== "seek" ||
            Math.abs(record.position - position) <= SEEK_MATCH_TOLERANCE_S),
      );
      if (index === -1) return false;
      records.splice(index, 1);
      return true;
    },
    [],
  );

  /**
   * play() can reject (autoplay policy, iOS low-power mode). NotAllowedError
   * is NOT an error state — it means "needs one tap": the resume overlay
   * appears and its tap IS the user gesture that unlocks playback. No timers,
   * no automatic retries behind the user's back.
   * `onRejected` lets applyRemote mark the expectation as "completable
   * later" — the overlay tap then finishes the REMOTE command.
   */
  const attemptPlay = useCallback(
    (el: HTMLVideoElement, onRejected?: () => void) => {
      const request = el.play();
      if (request) {
        request.catch((err: unknown) => {
          if (err instanceof DOMException && err.name === "NotAllowedError") {
            patch({ resumeNeeded: true, playing: false });
            onRejected?.();
          } else {
            patch({
              error: "Playback failed. Re-select the file and try again.",
            });
          }
        });
      }
    },
    [patch],
  );

  // Element identity tag + element-level event wiring. Runs once; the
  // dataset guard keeps the identity stable across StrictMode's
  // double-invoked effects in dev.
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (!el.dataset.nodeId) {
      el.dataset.nodeId = crypto.randomUUID();
    }
    setNodeId(el.dataset.nodeId);
    setCanEnterFullscreen(
      typeof (el as VideoWithIOSFullscreen).webkitEnterFullscreen ===
        "function" || typeof el.requestFullscreen === "function",
    );

    const reportTime = () => patch({ currentTime: el.currentTime });
    // M5 intent mapping (docs/participant-state-machine.md §3):
    // - play/pause/seeked  → intent candidates (consumed by expectations,
    //   otherwise handed to the sink as USER intent);
    // - ended intentionally produces NO intent: the movie finished, the
    //   partner keeps watching until their own end; replay emits fresh
    //   play/seek intents through the normal path;
    // - waiting/playing/canplay → buffering state only, never intent.
    const emitIntent = (kind: PlayerIntentKind, position: number) => {
      if (consumeExpected(kind, position)) return;
      sinkRef.current?.({ kind, position });
    };
    const listeners: Array<[string, () => void]> = [
      ["loadedmetadata", () => patch({ status: "ready", duration: el.duration })],
      ["durationchange", () => patch({ duration: el.duration })],
      ["timeupdate", reportTime],
      ["seeked", () => {
        reportTime();
        emitIntent("seek", el.currentTime);
      }],
      ["play", () => {
        patch({ playing: true, ended: false, resumeNeeded: false });
        emitIntent("play", el.currentTime);
      }],
      ["playing", () => patch({ buffering: false })],
      ["pause", () => {
        patch({ playing: false });
        // Reaching the end fires pause on some engines — that is not a
        // user pause and must not sync (see the ended rule above).
        if (!el.ended) emitIntent("pause", el.currentTime);
      }],
      ["ended", () => patch({ playing: false, ended: true })],
      ["waiting", () => patch({ buffering: true })],
      ["canplay", () => patch({ buffering: false })],
      ["volumechange", () => patch({ muted: el.muted })],
    ];
    const onError = () => {
      const code = el.error?.code ?? 0;
      patch({
        status: "error",
        playing: false,
        buffering: false,
        error: MEDIA_ERROR_TEXT[code] ?? MEDIA_ERROR_FALLBACK,
      });
    };

    for (const [type, handler] of listeners) {
      el.addEventListener(type, handler);
    }
    el.addEventListener("error", onError);
    return () => {
      for (const [type, handler] of listeners) {
        el.removeEventListener(type, handler);
      }
      el.removeEventListener("error", onError);
      // The sink belongs to a sync engine bound to THIS element wiring —
      // drop it so a destroyed engine can never receive intents.
      sinkRef.current = null;
    };
  }, [consumeExpected, patch]);

  const loadLocalFile = useCallback(
    (file: File) => {
      const el = videoRef.current;
      if (!el) return;

      if (!file.type.startsWith("video/")) {
        patch({
          status: "error",
          error: "That does not look like a video file.",
        });
        return;
      }

      // The previous movie's blob URL is dead the moment the new src is set.
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
      }
      const url = URL.createObjectURL(file);
      objectUrlRef.current = url;

      patch({
        status: "loading",
        fileName: file.name,
        fileSize: file.size,
        error: null,
        resumeNeeded: false,
        ended: false,
        buffering: false,
        currentTime: 0,
        duration: 0,
      });

      // R1 re-priming rule, M2 form: the swap happens inside the picker's
      // gesture, and play() is issued in the same gesture — no awaits, no
      // state round-trips in between. The iPhone test in this milestone is
      // exactly the verification of this rule on real hardware.
      el.src = url;
      el.load();
      attemptPlay(el);
    },
    [attemptPlay, patch],
  );

  const togglePlay = useCallback(() => {
    const el = videoRef.current;
    if (!el || !el.src) return;
    if (el.paused) {
      if (el.ended) {
        el.currentTime = 0; // replay from the start, explicitly
      }
      attemptPlay(el);
    } else {
      el.pause();
    }
  }, [attemptPlay]);

  const seek = useCallback((time: number) => {
    const el = videoRef.current;
    if (!el || !el.src) return;
    if (!Number.isFinite(time)) return;
    const clamped = Math.min(Math.max(time, 0), el.duration || 0);
    el.currentTime = clamped;
  }, []);

  const toggleMuted = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    el.muted = !el.muted;
  }, []);

  const enterFullscreen = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    // iPhone Safari: only the element-level native fullscreen exists, and it
    // fires element-level events — which is what sync will listen to.
    const iosEl = el as VideoWithIOSFullscreen;
    if (typeof iosEl.webkitEnterFullscreen === "function") {
      iosEl.webkitEnterFullscreen();
      return;
    }
    if (typeof el.requestFullscreen === "function") {
      el.requestFullscreen().catch(() => {
        // Fullscreen refusal is not a playback failure; ignore.
      });
    }
  }, []);

  const resume = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    attemptPlay(el);
  }, [attemptPlay]);

  // --- M5 seam ---------------------------------------------------------------

  const setIntentSink = useCallback((sink: PlayerIntentSink | null) => {
    sinkRef.current = sink;
  }, []);

  /**
   * Apply a REMOTE command (partner broadcast, snapshot anchor, system pause
   * or drift correction) through the one writer. Registers expectations
   * FIRST so the element events these calls cause are consumed, never
   * re-emitted as user intent (the R3 echo rule at the element level).
   *
   * Remote play also positions the element: a partner starting playback at
   * P means "watch from P", not "watch from wherever I was paused". The
   * positioning seek carries its own expectation. If play() is rejected
   * (un-primed element — the normal iOS first-join case) the play
   * expectation is EXTENDED so the overlay tap completes the remote command
   * instead of emitting a duplicate user play.
   */
  const applyRemote = useCallback(
    (intent: PlayerIntent) => {
      const el = videoRef.current;
      if (!el || !el.src) return; // nothing loaded yet — nothing to move

      // Duration is NaN/0 until metadata arrives. Falling back to 0 would
      // clamp every early seek (join-rule catch-up, remote play) to the
      // start; an unbounded upper limit lets the element queue the seek.
      const clamp = (time: number) => {
        const max =
          Number.isFinite(el.duration) && el.duration > 0
            ? el.duration
            : Number.POSITIVE_INFINITY;
        return Math.min(Math.max(time, 0), max);
      };

      const doSeek = (position: number) => {
        const target = clamp(position);
        expectIntent("seek", target);
        el.currentTime = target;
      };

      if (intent.kind === "seek") {
        if (!Number.isFinite(intent.position)) return;
        doSeek(intent.position);
        return;
      }

      if (intent.kind === "pause") {
        // A shared pause freezes an exact position. If this element drifted
        // (or never followed an earlier seek), move it to the anchor first;
        // pausing in place would leave the two screens at different times.
        if (
          Number.isFinite(intent.position) &&
          Math.abs(el.currentTime - intent.position) > SEEK_MATCH_TOLERANCE_S
        ) {
          doSeek(intent.position);
        }
        // pause() on an already-paused element fires no event, so recording
        // an expectation would only risk swallowing the next real pause.
        if (el.paused) return;
        expectIntent("pause", null);
        el.pause();
        return;
      }

      // kind === "play"
      const target = Number.isFinite(intent.position)
        ? clamp(intent.position)
        : el.currentTime;
      const needsSeek =
        el.ended || Math.abs(el.currentTime - target) > SEEK_MATCH_TOLERANCE_S;
      if (needsSeek) {
        doSeek(target); // restart-after-ended is also handled here
      }
      // play() on an already-playing element fires no event; only request
      // playback when the element is actually paused/ended.
      if (!el.paused && !el.ended) return;
      expectIntent("play", null);
      attemptPlay(el, () => {
        // NotAllowedError: keep the expectation alive for the overlay tap.
        const records = expectedRef.current;
        for (let i = records.length - 1; i >= 0; i -= 1) {
          if (records[i].kind === "play") {
            records[i].expiresAt =
              Date.now() + REMOTE_PLAY_REJECTED_TTL_MS;
            break;
          }
        }
      });
    },
    [attemptPlay, expectIntent],
  );

  const phase = phaseFromPathname(pathname);
  const loaded = state.status !== "idle";

  return (
    <PersistentContext.Provider
      value={{
        videoRef,
        nodeId,
        state,
        loadLocalFile,
        togglePlay,
        seek,
        toggleMuted,
        enterFullscreen,
        canEnterFullscreen,
        setIntentSink,
        expectIntent,
        applyRemote,
      }}
    >
      <div className="persistent-shell">
        {/* The dock only changes size/visibility per phase — the <video>
            inside is the same DOM node for the entire session. */}
        <div
          className="video-dock"
          data-phase={phase}
          data-loaded={loaded ? "yes" : "no"}
        >
          <video ref={videoRef} playsInline preload="metadata" />
          {phase === "watch" && state.status === "idle" ? (
            <div className="dock-hint" aria-hidden="true">
              Your screen. Choose a movie below to begin.
            </div>
          ) : null}
          {state.resumeNeeded ? <ResumeOverlay onResume={resume} /> : null}
        </div>
        {children}
      </div>
    </PersistentContext.Provider>
  );
}
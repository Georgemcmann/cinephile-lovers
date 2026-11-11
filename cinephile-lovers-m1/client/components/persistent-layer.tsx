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

  const patch = useCallback((partial: Partial<PlayerState>) => {
    setState((prev) => ({ ...prev, ...partial }));
  }, []);

  /**
   * play() can reject (autoplay policy, iOS low-power mode). NotAllowedError
   * is NOT an error state — it means "needs one tap": the resume overlay
   * appears and its tap IS the user gesture that unlocks playback. No timers,
   * no automatic retries behind the user's back.
   */
  const attemptPlay = useCallback(
    (el: HTMLVideoElement) => {
      const request = el.play();
      if (request) {
        request.catch((err: unknown) => {
          if (err instanceof DOMException && err.name === "NotAllowedError") {
            patch({ resumeNeeded: true, playing: false });
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
    const listeners: Array<[string, () => void]> = [
      [
        "loadedmetadata",
        () => patch({ status: "ready", duration: el.duration }),
      ],
      ["durationchange", () => patch({ duration: el.duration })],
      ["timeupdate", reportTime],
      ["seeked", reportTime],
      [
        "play",
        () => patch({ playing: true, ended: false, resumeNeeded: false }),
      ],
      ["playing", () => patch({ buffering: false })],
      ["pause", () => patch({ playing: false })],
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
    };
  }, [patch]);

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

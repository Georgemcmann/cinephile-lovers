/**
 * Sync engine (M5) — the client half of docs/participant-state-machine.md.
 *
 * The server owns ONE anchor per room ({ state, position, at, seq, by }).
 * This engine:
 *
 * 1. CLOCK — samples server time (NTP-style) via sync:ping, keeps the
 *    LOWEST-RTT sample of each burst (5 samples on start/connect, a
 *    re-measure burst every 45 s — review R3's clock model), and projects
 *    anchors with serverNow().
 *
 * 2. ECHO SUPPRESSION (R3) — commands it EMITS are remembered keyed by
 *    kind:revision with an expiry window. The server broadcasts to the whole
 *    room INCLUDING the sender; an echo matching a pending revision is
 *    consumed (the element already did it). Everything else — including the
 *    partner's commands — is applied through the persistent layer's
 *    applyRemote(), which registers expected-action records so the resulting
 *    element events never re-enter the intent path. Unmatched element
 *    events are USER intent (registered via the intent sink).
 *
 * 3. INTENT → COMMAND — user intents (play/pause/seek) are emitted as
 *    sync:command with a strictly increasing timestamp revision. The FIRST
 *    local play applies the JOIN RULE: if a screening is already running
 *    (anchor playing and far ahead), the device catches up to it instead of
 *    yanking the room back to the newcomer's position.
 *
 * 4. DRIFT SELF-CORRECTION (R3) — once per second, while the element is
 *    actually playing, drift = currentTime − expectedNow() is classified:
 *    |d| ≤ 0.5 s in sync; ≤ 1.5 s minor (correct after 10 s sustained, 30 s
 *    cooldown); > 1.5 s major (correct after 2 s sustained, 3 s cooldown).
 *    Corrections are applyRemote seeks — never broadcast (the anchor is
 *    already the truth). Checks pause while scrubbing, buffering, paused,
 *    ended, or right after any applied command.
 *
 * 5. INDICATORS — own buffering transitions are reported (sync:status,
 *    trailing-debounced); the partner's scrub/status feed the UI state.
 *    No shared pause on buffering (R3: indicator first, device testing
 *    decides more).
 *
 * Everything the engine publishes goes through one immutable UI-state
 * snapshot (useSyncExternalStore discipline — replace, never mutate).
 */

import type { Socket } from "socket.io-client";

import type { PlayerIntent, PlayerIntentSink } from "@/components/persistent-layer";

import {
  pingClock,
  sendScrub,
  sendStatus,
  sendSyncCommand,
  type PlaybackAnchor,
  type SlotId,
  type SyncCommandPayload,
  type SyncScrubPayload,
  type SyncStatusPayload,
} from "./room-socket";

// --- Tuning constants (docs/participant-state-machine.md §6) ----------------

const SCRUB_REPORT_INTERVAL_MS = 250; // R3 scrub throttle
const ECHO_TTL_MS = 5_000; // pending-command expiry window
const DRIFT_TICK_MS = 1_000;
const DRIFT_MINOR_S = 0.5;
const DRIFT_MAJOR_S = 1.5;
const SOFT_SUSTAIN_TICKS = 10;
const HARD_SUSTAIN_TICKS = 2;
const SOFT_COOLDOWN_MS = 30_000;
const HARD_COOLDOWN_MS = 3_000;
const APPLY_GRACE_MS = 2_000; // no drift checks right after applying a command
const CLOCK_BURST_GAP_MS = 150;
const CLOCK_BURST_INITIAL = 5;
const CLOCK_BURST_REMEASURE = 3;
const CLOCK_REMEASURE_MS = 45_000;
const STATUS_DEBOUNCE_MS = 400;
const PARTNER_SCRUB_TTL_MS = 1_600;
const PARTNER_BUFFERING_SAFETY_MS = 10_000;
const PARTNER_LOST_NOTICE_MS = 15_000;
const RESYNC_FLASH_MS = 3_000;

export type SyncUiState = {
  partnerScrubbing: boolean;
  partnerScrubPosition: number | null;
  partnerBuffering: boolean;
  /** True for a short window after the server paused for a lost partner. */
  partnerLostNotice: boolean;
  /** True for a short window after a major (hard) drift correction. */
  resyncFlash: boolean;
  clockOffsetMs: number | null;
  clockRttMs: number | null;
};

export const EMPTY_SYNC_UI: SyncUiState = {
  partnerScrubbing: false,
  partnerScrubPosition: null,
  partnerBuffering: false,
  partnerLostNotice: false,
  resyncFlash: false,
  clockOffsetMs: null,
  clockRttMs: null,
};

export type SyncEngineDeps = {
  socket: Socket;
  slot: SlotId;
  getVideo: () => HTMLVideoElement | null;
  setIntentSink: (sink: PlayerIntentSink | null) => void;
  applyRemote: (intent: PlayerIntent) => void;
};

export type SyncEngine = {
  /** Feed the anchor from a join/hello/resume snapshot (seq-guarded). */
  applyAnchorFromSnapshot: (playback: PlaybackAnchor | null) => void;
  handleSyncCommand: (payload: SyncCommandPayload) => void;
  handleScrub: (payload: SyncScrubPayload) => void;
  handleStatus: (payload: SyncStatusPayload) => void;
  /** From the seek bar: throttled live scrub indicator. */
  reportScrub: (position: number) => void;
  /** From the seek bar: drift checks pause while the user is scrubbing. */
  setScrubbing: (scrubbing: boolean) => void;
  subscribe: (listener: () => void) => () => void;
  getUiState: () => SyncUiState;
  destroy: () => void;
};

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

// Module-level so engine re-creation (reconnect, hello, StrictMode) can
// never rewind the revision clock. The server rejects rev <= lastRev[slot],
// and Date.now() keeps this monotonic across reloads in practice.
let lastRev = 0;

export function createSyncEngine(deps: SyncEngineDeps): SyncEngine {
  const pendingEcho = new Map<string, number>();
  let anchor: PlaybackAnchor | null = null;
  let lastApplyAt = 0;
  let firstPlaySeen = false;
  let scrubbing = false;
  let lastScrubSentAt = 0;
  let softTicks = 0;
  let hardTicks = 0;
  let lastCorrectionAt = 0;
  // Join catch-up: a slow first seek (large local file, unbuffered region)
  // can finish seconds after the target was projected. Re-project on each
  // completed seek for a bounded window instead of waiting for drift ticks.
  let catchUpUntil = 0;
  let catchUpAttempts = 0;
  let destroyed = false;

  // clock
  let bestRttMs = Number.POSITIVE_INFINITY;
  let offsetMs = 0;
  let clockRttPublished: number | null = null;

  // buffering status reporting
  let pendingBuffering = false;
  let lastSentBuffering = false;
  let lastStatusSentAt = 0;
  let statusTimer: ReturnType<typeof setTimeout> | undefined;

  // UI state (immutable snapshots — M3 lesson: never mutate in place)
  let ui: SyncUiState = EMPTY_SYNC_UI;
  let scrubIndicatorTimer: ReturnType<typeof setTimeout> | undefined;
  let bufferingSafetyTimer: ReturnType<typeof setTimeout> | undefined;
  let lostNoticeTimer: ReturnType<typeof setTimeout> | undefined;
  let resyncFlashTimer: ReturnType<typeof setTimeout> | undefined;
  const uiListeners = new Set<() => void>();

  const publishUi = (partial: Partial<SyncUiState>) => {
    ui = { ...ui, ...partial };
    for (const listener of uiListeners) listener();
  };

  // --- clock ----------------------------------------------------------------

  const sampleClock = async (): Promise<void> => {
    if (destroyed || !deps.socket.connected) return;
    const tSend = Date.now();
    const ack = await pingClock(deps.socket, tSend);
    if (destroyed || !ack.ok) return;
    const rtt = Date.now() - tSend;
    const offset = ack.tServer - tSend - rtt / 2;
    // Lowest RTT wins: it is the least distorted estimate (review R3).
    if (rtt < bestRttMs) {
      bestRttMs = rtt;
      offsetMs = offset;
      if (clockRttPublished === null || rtt < clockRttPublished) {
        clockRttPublished = rtt;
        publishUi({ clockOffsetMs: Math.round(offset), clockRttMs: rtt });
      }
    }
  };

  const clockBurst = async (count: number): Promise<void> => {
    for (let i = 0; i < count; i += 1) {
      if (destroyed) return;
      void sampleClock();
      await sleep(CLOCK_BURST_GAP_MS);
    }
  };

  const remeasureTimer = setInterval(() => {
    void clockBurst(CLOCK_BURST_REMEASURE);
  }, CLOCK_REMEASURE_MS);
  remeasureTimer.unref?.();

  const onSocketConnect = () => {
    void clockBurst(CLOCK_BURST_INITIAL);
  };
  deps.socket.on("connect", onSocketConnect);
  void clockBurst(CLOCK_BURST_INITIAL); // engine starts post-join: socket is live

  const serverNow = () => Date.now() + offsetMs;

  // --- anchor projection ------------------------------------------------------

  const expectedNow = (): number | null => {
    if (!anchor) return null;
    if (anchor.state !== "playing") return anchor.position;
    return anchor.position + (serverNow() - anchor.at) / 1000;
  };

  const noteApply = () => {
    lastApplyAt = Date.now();
    softTicks = 0;
    hardTicks = 0;
  };

  // --- intent → command -------------------------------------------------------

  const nextRev = () => {
    lastRev = Math.max(Date.now(), lastRev + 1);
    return lastRev;
  };

  const emitCommand = (kind: "play" | "pause" | "seek", position: number) => {
    const now = Date.now();
    // A broadcast can be lost (disconnect mid-command); drop expired records
    // so the map cannot grow for the lifetime of a long screening.
    for (const [key, expiresAt] of pendingEcho) {
      if (expiresAt <= now) pendingEcho.delete(key);
    }
    const rev = nextRev();
    pendingEcho.set(`${kind}:${rev}`, now + ECHO_TTL_MS);
    sendSyncCommand(deps.socket, { kind, position, rev });
  };

  /**
   * USER intent (unmatched element event). The FIRST play of a session
   * applies the join rule: never yank a running screening back to the
   * newcomer's position — catch up instead (docs/participant-state-machine
   * .md §4).
   */
  const onIntent: PlayerIntentSink = (intent) => {
    if (destroyed) return;
    const el = deps.getVideo();
    if (!el) return;
    // A real user action supersedes any in-flight join catch-up.
    catchUpUntil = 0;

    if (intent.kind === "play") {
      const joinRule = !firstPlaySeen;
      firstPlaySeen = true;
      if (joinRule && anchor) {
        const target =
          anchor.state === "playing" ? expectedNow() : anchor.position;
        if (
          target !== null &&
          Math.abs(intent.position - target) > DRIFT_MAJOR_S
        ) {
          deps.applyRemote({ kind: "seek", position: target });
          noteApply();
          catchUpUntil = Date.now() + 8_000;
          catchUpAttempts = 0;
          if (anchor.state === "paused") {
            emitCommand("play", target);
          }
          return;
        }
      }
      emitCommand("play", intent.position);
      return;
    }

    if (intent.kind === "pause") {
      // Reaching the end is not a user pause (the element's pause listener
      // already filters ended; this is the belt for direct sink calls).
      if (el.ended) return;
      emitCommand("pause", intent.position);
      return;
    }

    emitCommand("seek", intent.position);
  };
  deps.setIntentSink(onIntent);

  // --- inbound commands -------------------------------------------------------

  const handleSyncCommand = (payload: SyncCommandPayload) => {
    if (destroyed) return;
    const key = `${payload.kind}:${payload.rev}`;
    if (payload.by === deps.slot && pendingEcho.has(key)) {
      const expiresAt = pendingEcho.get(key) ?? 0;
      pendingEcho.delete(key);
      if (expiresAt > Date.now()) {
        // OUR echo: the element already did this, but the engine must still
        // record the server's anchor. Otherwise the sender's drift monitor
        // keeps comparing against a stale position and undoes the command.
        if (payload.seq > (anchor?.seq ?? 0)) {
          anchor = {
            state: payload.state,
            position: payload.position,
            at: payload.at,
            seq: payload.seq,
            by: payload.by,
          };
        }
        noteApply();
        return;
      }
    }
    if (payload.seq <= (anchor?.seq ?? 0)) return; // stale reorder guard
    anchor = {
      state: payload.state,
      position: payload.position,
      at: payload.at,
      seq: payload.seq,
      by: payload.by,
    };
    if (payload.state !== "playing") catchUpUntil = 0;
    noteApply();
    deps.applyRemote({ kind: payload.kind, position: payload.position });
    if (payload.by === "system" && payload.reason === "partner_lost") {
      publishUi({ partnerLostNotice: true });
      if (lostNoticeTimer) clearTimeout(lostNoticeTimer);
      lostNoticeTimer = setTimeout(() => {
        lostNoticeTimer = undefined;
        publishUi({ partnerLostNotice: false });
      }, PARTNER_LOST_NOTICE_MS);
      lostNoticeTimer.unref?.();
    } else if (payload.kind === "play" && ui.partnerLostNotice) {
      // Playback resumed after the shared pause — retire the notice now.
      if (lostNoticeTimer) clearTimeout(lostNoticeTimer);
      lostNoticeTimer = undefined;
      publishUi({ partnerLostNotice: false });
    }
  };

  const applyAnchorFromSnapshot = (playback: PlaybackAnchor | null) => {
    if (destroyed || !playback) return;
    if (playback.seq <= (anchor?.seq ?? 0)) return;
    anchor = playback;
    if (playback.state !== "playing") catchUpUntil = 0;
    const el = deps.getVideo();
    if (!el || !el.src) return; // no file yet — the join rule catches up later
    noteApply();
    if (playback.state === "playing") {
      deps.applyRemote({ kind: "play", position: playback.position });
      return;
    }
    // A paused anchor carries a position: move there before freezing, or a
    // late joiner would sit at 0:00 showing a position nobody shares.
    if (Math.abs(el.currentTime - playback.position) > DRIFT_MINOR_S) {
      deps.applyRemote({ kind: "seek", position: playback.position });
    }
    deps.applyRemote({ kind: "pause", position: playback.position });
  };

  // --- partner indicators -------------------------------------------------------

  const handleScrub = (payload: SyncScrubPayload) => {
    if (destroyed) return;
    publishUi({ partnerScrubbing: true, partnerScrubPosition: payload.position });
    if (scrubIndicatorTimer) clearTimeout(scrubIndicatorTimer);
    scrubIndicatorTimer = setTimeout(() => {
      scrubIndicatorTimer = undefined;
      publishUi({ partnerScrubbing: false });
    }, PARTNER_SCRUB_TTL_MS);
    scrubIndicatorTimer.unref?.();
  };

  const handleStatus = (payload: SyncStatusPayload) => {
    if (destroyed) return;
    publishUi({ partnerBuffering: payload.buffering });
    if (payload.buffering) {
      if (bufferingSafetyTimer) clearTimeout(bufferingSafetyTimer);
      bufferingSafetyTimer = setTimeout(() => {
        bufferingSafetyTimer = undefined;
        publishUi({ partnerBuffering: false });
      }, PARTNER_BUFFERING_SAFETY_MS);
      bufferingSafetyTimer.unref?.();
    } else if (bufferingSafetyTimer) {
      clearTimeout(bufferingSafetyTimer);
      bufferingSafetyTimer = undefined;
    }
  };

  // --- own buffering status (trailing-debounced) ------------------------------

  const flushStatus = () => {
    if (pendingBuffering === lastSentBuffering) return;
    lastSentBuffering = pendingBuffering;
    lastStatusSentAt = Date.now();
    sendStatus(deps.socket, pendingBuffering);
  };

  const reportBuffering = (buffering: boolean) => {
    if (destroyed) return;
    pendingBuffering = buffering;
    if (statusTimer) return; // a trailing flush is already scheduled
    const gap = Date.now() - lastStatusSentAt;
    if (gap >= STATUS_DEBOUNCE_MS) {
      flushStatus();
    } else {
      statusTimer = setTimeout(() => {
        statusTimer = undefined;
        flushStatus();
      }, STATUS_DEBOUNCE_MS - gap);
      statusTimer.unref?.();
    }
  };

  const el = deps.getVideo();
  const statusListeners: Array<[string, () => void]> = [
    ["waiting", () => reportBuffering(true)],
    ["playing", () => reportBuffering(false)],
    ["canplay", () => reportBuffering(false)],
  ];
  if (el) {
    for (const [type, handler] of statusListeners) {
      el.addEventListener(type, handler);
    }
  }

  /**
   * Completed a seek during the join catch-up window: the target was
   * projected against the clock and the element needed time to get there.
   * Project again now and keep closing the gap (bounded by the window and
   * attempt count). Without this, a slow first seek can leave the newcomer
   * seconds behind until the drift monitor's sustained-error ticks elapse.
   */
  const onSeeked = () => {
    if (destroyed || Date.now() > catchUpUntil) return;
    const video = deps.getVideo();
    if (!video || video.paused || !anchor || anchor.state !== "playing") {
      catchUpUntil = 0;
      return;
    }
    const expected = expectedNow();
    if (expected === null) return;
    if (
      Math.abs(video.currentTime - expected) <= DRIFT_MINOR_S ||
      catchUpAttempts >= 6
    ) {
      catchUpUntil = 0;
      return;
    }
    catchUpAttempts += 1;
    deps.applyRemote({ kind: "seek", position: expected });
    noteApply();
  };
  el?.addEventListener("seeked", onSeeked);

  // --- drift monitor ------------------------------------------------------------

  const correct = (target: number, hard: boolean) => {
    deps.applyRemote({ kind: "seek", position: target });
    noteApply();
    lastCorrectionAt = Date.now();
    if (hard) {
      publishUi({ resyncFlash: true });
      if (resyncFlashTimer) clearTimeout(resyncFlashTimer);
      resyncFlashTimer = setTimeout(() => {
        resyncFlashTimer = undefined;
        publishUi({ resyncFlash: false });
      }, RESYNC_FLASH_MS);
      resyncFlashTimer.unref?.();
    }
  };

  const driftTimer = setInterval(() => {
    if (destroyed) return;
    const video = deps.getVideo();
    if (!video || !anchor || anchor.state !== "playing") {
      softTicks = 0;
      hardTicks = 0;
      return;
    }
    if (
      scrubbing ||
      !deps.socket.connected ||
      video.paused ||
      video.ended ||
      video.readyState < 3
    ) {
      softTicks = 0;
      hardTicks = 0;
      return;
    }
    if (Date.now() - lastApplyAt < APPLY_GRACE_MS) return;
    const expected = expectedNow();
    if (expected === null) return;
    const drift = video.currentTime - expected;
    const distance = Math.abs(drift);
    if (distance <= DRIFT_MINOR_S) {
      softTicks = 0;
      hardTicks = 0;
      return;
    }
    if (distance <= DRIFT_MAJOR_S) {
      softTicks += 1;
      hardTicks = 0;
      if (
        softTicks >= SOFT_SUSTAIN_TICKS &&
        Date.now() - lastCorrectionAt >= SOFT_COOLDOWN_MS
      ) {
        correct(expected, false);
      }
      return;
    }
    hardTicks += 1;
    softTicks = 0;
    if (
      hardTicks >= HARD_SUSTAIN_TICKS &&
      Date.now() - lastCorrectionAt >= HARD_COOLDOWN_MS
    ) {
      correct(expected, true);
    }
  }, DRIFT_TICK_MS);
  driftTimer.unref?.();

  // --- public surface ------------------------------------------------------------

  const engineSurface: SyncEngine = {
    applyAnchorFromSnapshot,
    handleSyncCommand,
    handleScrub,
    handleStatus,
    reportScrub(position: number) {
      if (destroyed || !Number.isFinite(position)) return;
      const now = Date.now();
      if (now - lastScrubSentAt >= SCRUB_REPORT_INTERVAL_MS) {
        lastScrubSentAt = now;
        sendScrub(deps.socket, position);
      }
    },
    setScrubbing(value: boolean) {
      scrubbing = value;
    },
    subscribe(listener: () => void) {
      uiListeners.add(listener);
      return () => {
        uiListeners.delete(listener);
      };
    },
    getUiState() {
      return ui;
    },
    destroy() {
      destroyed = true;
      deps.setIntentSink(null);
      clearInterval(driftTimer);
      clearInterval(remeasureTimer);
      deps.socket.off("connect", onSocketConnect);
      if (el) {
        for (const [type, handler] of statusListeners) {
          el.removeEventListener(type, handler);
        }
        el.removeEventListener("seeked", onSeeked);
      }
      if (statusTimer) clearTimeout(statusTimer);
      if (scrubIndicatorTimer) clearTimeout(scrubIndicatorTimer);
      if (bufferingSafetyTimer) clearTimeout(bufferingSafetyTimer);
      if (lostNoticeTimer) clearTimeout(lostNoticeTimer);
      if (resyncFlashTimer) clearTimeout(resyncFlashTimer);
      if (typeof window !== "undefined") {
        delete (window as { __clSyncDebug?: unknown }).__clSyncDebug;
      }
    },
  };

  // DEV-ONLY verification hook: lets the browser E2E skew the clock offset
  // to drive the drift-correction path honestly (no element faking). The
  // branch is dead code in production builds (NODE_ENV is inlined by Next).
  if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") {
    (window as { __clSyncDebug?: unknown }).__clSyncDebug = {
      skewClock: (ms: number) => {
        offsetMs += ms;
      },
    };
  }

  return engineSurface;
}
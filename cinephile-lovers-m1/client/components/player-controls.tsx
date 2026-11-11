"use client";

import { useState } from "react";
import { Maximize, Pause, Play, Volume2, VolumeX } from "lucide-react";

import { usePersistentVideo } from "./persistent-layer";

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0:00";
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const mm = hours > 0 ? String(minutes).padStart(2, "0") : String(minutes);
  const ss = String(secs).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${minutes}:${ss}`;
}

/**
 * PlayerControls — the M2 control surface. Every button routes through the
 * persistent layer's command API; this component holds no direct element
 * reference. M5's sync engine intercepts at that seam, so keeping the
 * controls "dumb" now is what makes the sync integration small later.
 *
 * Seek semantics: while dragging, only the visual position updates; the
 * actual seek is committed once on release (pointer, keyboard or blur). The
 * M4/M5 scrub-throttle + echo-suppression composition (review R3) builds on
 * exactly this "commit-on-release" shape.
 *
 * Deliberately absent: a volume slider — iPhone Safari exposes no scriptable
 * volume (it is a hardware control there). A mute toggle works everywhere.
 */
export function PlayerControls() {
  const {
    state,
    togglePlay,
    seek,
    toggleMuted,
    enterFullscreen,
    canEnterFullscreen,
  } = usePersistentVideo();
  const [scrubValue, setScrubValue] = useState<number | null>(null);

  const disabled = state.status !== "ready";
  const duration = state.duration > 0 ? state.duration : 0;
  const shownTime = scrubValue ?? state.currentTime;

  const commitScrub = () => {
    if (scrubValue !== null && Number.isFinite(scrubValue)) {
      seek(scrubValue);
    }
    setScrubValue(null);
  };

  return (
    <section
      className="flex flex-col gap-2 rounded-2xl border border-line bg-panel p-4"
      aria-label="Player controls"
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="icon-btn icon-btn--primary"
          onClick={togglePlay}
          disabled={disabled}
          aria-label={state.playing ? "Pause" : "Play"}
        >
          {state.playing ? (
            <Pause size={20} aria-hidden="true" />
          ) : (
            <Play
              size={20}
              className="translate-x-px"
              aria-hidden="true"
            />
          )}
        </button>

        <span
          className="font-mono text-xs tabular-nums text-muted"
          data-testid="current-time"
        >
          {formatTime(shownTime)}
        </span>

        <input
          type="range"
          className="seek-range min-w-0 flex-1"
          min={0}
          max={duration}
          step={0.1}
          value={duration > 0 ? Math.min(shownTime, duration) : 0}
          disabled={disabled || duration <= 0}
          aria-label="Seek in movie"
          onChange={(event) => {
            const value = event.currentTarget.valueAsNumber;
            if (Number.isFinite(value)) {
              setScrubValue(value);
            }
          }}
          onPointerUp={commitScrub}
          onPointerCancel={commitScrub}
          onKeyUp={commitScrub}
          onBlur={commitScrub}
        />

        <span className="font-mono text-xs tabular-nums text-muted">
          {formatTime(duration)}
        </span>

        <button
          type="button"
          className="icon-btn"
          onClick={toggleMuted}
          disabled={disabled}
          aria-label={state.muted ? "Unmute" : "Mute"}
        >
          {state.muted ? (
            <VolumeX size={20} aria-hidden="true" />
          ) : (
            <Volume2 size={20} aria-hidden="true" />
          )}
        </button>

        {canEnterFullscreen ? (
          <button
            type="button"
            className="icon-btn"
            onClick={enterFullscreen}
            disabled={disabled}
            aria-label="Fullscreen"
          >
            <Maximize size={20} aria-hidden="true" />
          </button>
        ) : null}
      </div>

      {state.buffering ? (
        <p className="text-xs text-muted" role="status">
          Buffering…
        </p>
      ) : null}
    </section>
  );
}
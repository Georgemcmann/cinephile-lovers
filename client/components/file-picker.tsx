"use client";

import { useRef } from "react";
import { Clapperboard, RotateCcw } from "lucide-react";

import { usePersistentVideo } from "./persistent-layer";

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exp = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / 1024 ** exp;
  return `${value >= 10 || exp === 0 ? Math.round(value) : value.toFixed(1)} ${units[exp]}`;
}

/**
 * FilePicker — the ONLY door through which a movie enters the app (M2: local
 * files; nothing is uploaded, ever).
 *
 * The hidden input's change event is the user gesture; loadLocalFile() is
 * called synchronously inside it so that the src swap + play() stay inside
 * the gesture (review R1 priming rule). The input value is reset afterwards
 * so re-choosing the SAME file still fires a change event — a new file pick
 * is always a fresh gesture, which is what makes the re-priming legal.
 */
export function FilePicker() {
  const { state, loadLocalFile } = usePersistentVideo();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const hasFile = state.status !== "idle";

  const openPicker = () => {
    inputRef.current?.click();
  };

  return (
    <section
      className="flex flex-col gap-3 rounded-2xl border border-line bg-panel p-4"
      aria-label="Movie file"
    >
      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        className="sr-only"
        aria-label="Choose a movie file"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) {
            loadLocalFile(file);
          }
          // Reset so choosing the SAME file again still fires change.
          event.target.value = "";
        }}
      />

      {hasFile ? (
        <div className="flex flex-col gap-1">
          <p
            className="truncate text-sm font-medium"
            title={state.fileName ?? undefined}
          >
            {state.fileName}
          </p>
          <p className="text-xs text-muted" data-testid="file-status">
            {state.status === "loading"
              ? "Reading file…"
              : state.status === "ready"
                ? `${formatBytes(state.fileSize ?? 0)} · ready on this device`
                : "Not playable"}
          </p>
        </div>
      ) : (
        <p className="text-sm text-muted">
          Each of you picks your own copy of the same movie. The file never
          leaves this device.
        </p>
      )}

      {state.error ? <p className="text-sm text-soft">{state.error}</p> : null}

      <button
        type="button"
        onClick={openPicker}
        className={
          hasFile
            ? "inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-line px-6 text-sm font-medium text-ink transition-colors hover:bg-elevated"
            : "inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-btn-red px-6 font-semibold text-ink transition-colors hover:bg-btn-red-deep"
        }
      >
        {hasFile ? (
          <>
            <RotateCcw size={16} aria-hidden="true" />
            Choose a different file
          </>
        ) : (
          <>
            <Clapperboard size={18} aria-hidden="true" />
            Choose a movie
          </>
        )}
      </button>

      {!hasFile ? (
        <p className="text-xs leading-relaxed text-muted">
          Tip for iPhones: H.264 video + AAC audio in an MP4 container plays
          everywhere.
        </p>
      ) : null}
    </section>
  );
}
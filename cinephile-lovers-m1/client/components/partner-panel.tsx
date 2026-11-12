"use client";

import { CheckCircle2, CircleDashed, LogOut, TriangleAlert, UserRound, UserRoundX } from "lucide-react";

import type { SlotId, Snapshot } from "@/lib/room-socket";

type PartnerPanelProps = {
  youSlot: SlotId;
  youRole: "creator" | "partner";
  slots: Snapshot["slots"];
  files: Snapshot["files"];
  /** Creator-only action (M4): free the partner seat. */
  canReset: boolean;
  onReset: () => void;
  resetBusy: boolean;
};

function formatBytes(bytes: number): string {
  if (bytes >= 1_073_741_824) {
    return `${(bytes / 1_073_741_824).toFixed(2)} GB`;
  }
  if (bytes >= 1_048_576) {
    return `${(bytes / 1_048_576).toFixed(1)} MB`;
  }
  return `${bytes} B`;
}

function formatDuration(seconds: number): string {
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

/**
 * Presence + the M4 same-file check (docs/socket-events.md §7):
 * same movie ⇔ identical size AND durations within 2 seconds.
 * Names may differ; they are shown as-is.
 */
export function PartnerPanel({
  youSlot,
  youRole,
  slots,
  files,
  canReset,
  onReset,
  resetBusy,
}: PartnerPanelProps) {
  const partnerSlot: keyof typeof slots = youSlot === "A" ? "B" : "A";
  const partner = slots[partnerSlot];
  const myFile = files[youSlot as keyof typeof files];
  const partnerFile = files[partnerSlot];

  const sameFile =
    myFile !== null &&
    partnerFile !== null &&
    myFile.sizeBytes === partnerFile.sizeBytes &&
    Math.abs(myFile.durationSeconds - partnerFile.durationSeconds) <= 2;

  const presence = !partner.occupied
    ? {
        icon: <CircleDashed size={16} aria-hidden="true" />,
        text: "Waiting for your partner — share the invite link.",
        tone: "text-muted",
      }
    : partner.online
      ? {
          icon: <CheckCircle2 size={16} aria-hidden="true" />,
          text: "Partner connected.",
          tone: "text-ink",
        }
      : {
          icon: <UserRoundX size={16} aria-hidden="true" />,
          text: "Partner offline — their seat is held for them.",
          tone: "text-muted",
        };

  return (
    <section
      className="flex flex-col gap-3 rounded-2xl border border-line bg-panel p-4"
      aria-label="Partner"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">Your partner</p>
        <p className="flex items-center gap-1.5 text-xs text-muted">
          <UserRound size={14} aria-hidden="true" />
          You: {youRole} (seat {youSlot})
        </p>
      </div>

      <p className={`flex items-center gap-2 text-sm ${presence.tone}`}>
        {presence.icon}
        {presence.text}
      </p>

      <div className="flex flex-col gap-1 rounded-xl border border-line bg-elevated p-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted">
          Same-file check
        </p>
        {myFile || partnerFile ? (
          <>
            <p className="text-xs leading-relaxed text-muted">
              You: {myFile ? `${myFile.name} (${formatBytes(myFile.sizeBytes)}, ${formatDuration(myFile.durationSeconds)})` : "no file picked yet"}
            </p>
            <p className="text-xs leading-relaxed text-muted">
              Partner: {partnerFile ? `${partnerFile.name} (${formatBytes(partnerFile.sizeBytes)}, ${formatDuration(partnerFile.durationSeconds)})` : "no file picked yet"}
            </p>
            {myFile && partnerFile ? (
              sameFile ? (
                <p className="flex items-center gap-1.5 text-xs font-medium text-ink">
                  <CheckCircle2 size={14} aria-hidden="true" />
                  Looks like the same movie.
                </p>
              ) : (
                <p className="flex items-center gap-1.5 text-xs font-medium text-soft">
                  <TriangleAlert size={14} aria-hidden="true" />
                  These look like different files — check you picked the same cut.
                </p>
              )
            ) : (
              <p className="text-xs text-muted">
                Waiting for both of you to pick a file.
              </p>
            )}
          </>
        ) : (
          <p className="text-xs text-muted">
            Pick your copy of the movie below — sizes and durations are
            compared so you can be sure you are watching the same cut.
          </p>
        )}
      </div>

      {canReset ? (
        <button
          type="button"
          onClick={onReset}
          disabled={resetBusy || !partner.occupied}
          className="inline-flex min-h-11 items-center justify-center gap-2 self-start rounded-full border border-line px-4 text-sm text-muted transition-colors hover:text-ink disabled:opacity-40"
        >
          <LogOut size={14} aria-hidden="true" />
          {resetBusy ? "Freeing the seat…" : "Free the partner seat"}
        </button>
      ) : null}
    </section>
  );
}
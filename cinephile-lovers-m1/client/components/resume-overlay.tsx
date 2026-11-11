"use client";

/**
 * ResumeOverlay — the tap-to-resume surface (review R1: "tap-to-resume
 * overlay for rejected play(); no auto-resume assumptions").
 *
 * Renders whenever a play() call was rejected with NotAllowedError (autoplay
 * policy, iOS low-power mode). The tap itself is the user gesture that
 * unlocks the persistent element — no timers, no muted-autoplay fallback, no
 * retries behind the user's back.
 */
export function ResumeOverlay({ onResume }: { onResume: () => void }) {
  return (
    <button
      type="button"
      className="resume-overlay"
      onClick={onResume}
      aria-label="Tap to play"
    >
      <span className="resume-overlay__icon" aria-hidden="true">
        <svg
          width="26"
          height="26"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polygon points="6 3 20 12 6 21 6 3" />
        </svg>
      </span>
      <span className="resume-overlay__label">Tap to play</span>
    </button>
  );
}
"use client";

import { usePersistentVideo } from "./persistent-layer";

/**
 * NodeBadge — milestone test scaffolding (successor of M1's SpikeDebug,
 * reduced). Shows the persistent element's DOM identity (data-node-id, first
 * 8 characters) plus a live signal (t=… while playing, the status otherwise).
 *
 * On the iPhone this badge is how the M2 gate is checked visually: the id
 * must be identical on Lobby and Watch Room while playback continues. It is
 * deliberately minimal and gets removed at the M6 polish pass.
 */
export function NodeBadge({ label }: { label: string }) {
  const { nodeId, state } = usePersistentVideo();
  const id = nodeId ? `${nodeId.slice(0, 8)}…` : "…";
  const live = state.playing
    ? `t=${state.currentTime.toFixed(1)}s`
    : state.status;

  return (
    <span className="node-badge">
      [{label}] node={id} · {live}
    </span>
  );
}
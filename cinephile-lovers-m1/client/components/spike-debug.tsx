"use client";

import { useEffect, useState } from "react";

import { usePersistentVideo } from "./persistent-layer";

/**
 * SpikeDebug — M1-only verification chip (the M1 gate, brief §5).
 *
 * It reads the element's identity FROM THE DOM (data attribute), not from
 * React state, so the displayed id changes if and only if the <video> DOM
 * node was actually recreated. A ticking currentTime proves playback
 * continues across navigation. Removed in M2 when the real player lands.
 */
export function SpikeDebug({ label }: { label: string }) {
  const { videoRef } = usePersistentVideo();
  const [nodeId, setNodeId] = useState<string | null>(null);
  const [time, setTime] = useState(0);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    setNodeId(el.dataset.spikeId ?? null);
    const interval = window.setInterval(() => setTime(el.currentTime), 500);
    return () => window.clearInterval(interval);
  }, [videoRef]);

  return (
    <span className="spike-chip">
      [{label}] node={nodeId ?? "…"} · t={time.toFixed(1)}s
    </span>
  );
}

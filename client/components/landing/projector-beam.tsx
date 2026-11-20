"use client";

import { motion, useReducedMotion } from "framer-motion";

/*
 * Dust motes drifting inside the projector beam. The values are HARD-CODED
 * (not Math.random()) so server render and client hydration agree — random
 * values computed during render would cause a hydration mismatch.
 */
const DUST: Array<{
  left: string;
  size: number;
  rise: number;
  duration: number;
  delay: number;
  peak: number;
}> = [
  { left: "34%", size: 2.5, rise: 90, duration: 11, delay: 0, peak: 0.5 },
  { left: "38%", size: 2, rise: 130, duration: 14, delay: 2.1, peak: 0.4 },
  { left: "43%", size: 3, rise: 70, duration: 9.5, delay: 1.2, peak: 0.55 },
  { left: "47%", size: 2, rise: 150, duration: 16, delay: 4.4, peak: 0.35 },
  { left: "51%", size: 3.5, rise: 100, duration: 12, delay: 0.6, peak: 0.45 },
  { left: "55%", size: 2, rise: 120, duration: 13, delay: 3.3, peak: 0.4 },
  { left: "59%", size: 2.5, rise: 80, duration: 10, delay: 5.1, peak: 0.5 },
  { left: "63%", size: 2, rise: 140, duration: 15, delay: 1.8, peak: 0.3 },
  { left: "40%", size: 1.5, rise: 110, duration: 12.5, delay: 6.2, peak: 0.45 },
  { left: "57%", size: 1.5, rise: 95, duration: 11.5, delay: 2.7, peak: 0.5 },
  { left: "45%", size: 1.5, rise: 160, duration: 17, delay: 3.9, peak: 0.3 },
  { left: "61%", size: 1.5, rise: 85, duration: 10.5, delay: 5.7, peak: 0.4 },
  { left: "36%", size: 1.5, rise: 125, duration: 14.5, delay: 0.9, peak: 0.35 },
  { left: "53%", size: 2.5, rise: 105, duration: 13.5, delay: 4.9, peak: 0.45 },
];

/**
 * ProjectorBeam — Direction B's centerpiece: a warm projector cone cutting
 * through the black from the top of the hero, with dust motes floating in
 * the light.
 *
 * - The cone is a blurred, clip-path'd gradient that sways +-1.1deg
 *   (CSS --animate-beam-sway; the sway lives on an INNER div so it never
 *   fights the centering translate on the outer wrapper).
 * - Dust motes are framer-motion loops with per-particle duration/delay.
 * - With prefers-reduced-motion the sway and dust are dropped; a faint
 *   static beam remains so the composition still reads.
 *
 * Decorative only: aria-hidden + pointer-events-none.
 */
export function ProjectorBeam() {
  const reduceMotion = useReducedMotion();

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 top-0 h-[72svh] overflow-hidden"
    >
      {/* Lens flare: the bulb peeking over the top edge. */}
      <div className="absolute left-1/2 -top-3.5 h-4 w-44 -translate-x-1/2 rounded-[100%] bg-[#ffe9d2] opacity-60 blur-md" />

      {/* Beam cone: outer wrapper centers; inner div sways. */}
      <div className="absolute left-1/2 top-0 h-full w-[min(120vw,1400px)] origin-top -translate-x-1/2">
        <div
          className={`h-full w-full blur-[10px] ${reduceMotion ? "" : "animate-beam-sway"}`}
          style={{
            clipPath: "polygon(46.5% 0, 53.5% 0, 92% 100%, 8% 100%)",
            background:
              "linear-gradient(to bottom, rgba(255,236,214,0.16), rgba(255,236,214,0.05) 45%, transparent 78%)",
          }}
        />
      </div>

      {/* Dust motes rising through the light. */}
      {!reduceMotion
        ? DUST.map((mote, i) => (
            <motion.span
              key={i}
              className="absolute top-full rounded-full bg-[#ffe9d2]"
              style={{
                left: mote.left,
                width: mote.size,
                height: mote.size,
              }}
              animate={{ y: [mote.rise, -mote.rise], opacity: [0, mote.peak, 0] }}
              transition={{
                duration: mote.duration,
                delay: mote.delay,
                repeat: Infinity,
                ease: "easeInOut",
              }}
            />
          ))
        : null}
    </div>
  );
}
/*
 * Shared motion vocabulary for the landing heroes.
 *
 * All three hero variants (Midnight / Marquee / Noir) reuse the same
 * entrance choreography so switching between them feels coherent:
 * - One-shot entrances use explicit delays (a fixed beat sequence, not
 *   nested variants — see the Motion contract note in app/page.tsx).
 * - prefers-reduced-motion collapses every entrance into a pure fade.
 */
export const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

type MakeEnter = (delay: number) => {
  initial: { opacity: number; y?: number };
  animate: { opacity: number; y?: number };
  transition: {
    duration: number;
    delay: number;
    ease: [number, number, number, number] | "linear";
  };
};

/**
 * Returns an `enter(delay)` factory bound to the current reduced-motion
 * preference. Spread the result onto any framer-motion component:
 *   <motion.div {...enter(0.2)} />
 */
export function makeEnter(reduceMotion: boolean): MakeEnter {
  return (delay) =>
    reduceMotion
      ? {
          initial: { opacity: 0 },
          animate: { opacity: 1 },
          transition: { duration: 0.4, delay, ease: "linear" },
        }
      : {
          initial: { opacity: 0, y: 24 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.8, delay, ease: EASE },
        };
}
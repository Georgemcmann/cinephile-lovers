"use client";

import { useEffect, useRef, type CSSProperties } from "react";

/**
 * Reveal — scroll-triggered entrance for landing sections (M6 design pass).
 *
 * A tiny IntersectionObserver wrapper: children start shifted down and
 * transparent (the `.reveal` class in globals.css) and gain `.reveal--in`
 * once they enter the viewport. Class toggling is deliberately done ON THE
 * DOM NODE, not through React state — a reveal is a one-way, render-silent
 * visual transition, and skipping the re-render keeps scroll cheap on
 * older iPhones.
 *
 * Design rules this enforces (see globals.css, M6 motion foundation):
 * - transition on transform + opacity only (GPU-composited on iOS).
 * - `delay` staggers siblings without JS timers (a CSS transition-delay).
 * - With prefers-reduced-motion, the CSS collapses this to a static,
 *   fully-visible render — the component still works, just without motion.
 * - Without IntersectionObserver (very old browsers), content is shown
 *   immediately: never hide content behind a missing API.
 *
 * The observer fires ONCE and disconnects: content never re-hides when you
 * scroll back up (re-animating on every pass reads as a gimmick, not
 * polish).
 *
 * `as` lets the wrapper keep list semantics (`as="li"` inside <ol>/<ul>).
 * The Tag cast below is safe for this internal component: div/li/section
 * share the exact contract Reveal uses (className, style, ref for
 * classList + observe). The ref is typed for the div variant; the runtime
 * element only ever receives what all three tags support.
 */
export function Reveal({
  children,
  delay = 0,
  className = "",
  as = "div",
}: {
  children: React.ReactNode;
  /** Stagger in ms — applied as a CSS transition-delay. */
  delay?: number;
  className?: string;
  as?: "div" | "li" | "section";
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      el.classList.add("reveal--in");
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          el.classList.add("reveal--in");
          observer.disconnect();
        }
      },
      // Fire when the block is properly on screen, not on its first pixel.
      { threshold: 0.15, rootMargin: "0px 0px -48px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const style = delay > 0 ? ({ "--d": `${delay}ms` } as CSSProperties) : undefined;
  const Tag = as as "div";

  return (
    <Tag
      ref={ref}
      style={style}
      className={`reveal ${className}`.trim()}
    >
      {children}
    </Tag>
  );
}
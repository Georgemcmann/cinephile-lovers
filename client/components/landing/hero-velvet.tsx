"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight, KeyRound, ShieldCheck, Wifi } from "lucide-react";

import { makeEnter } from "@/components/landing/motion";

/*
 * HeroVelvet — M6b Variant B, "Velvet Noir".
 *
 * Art direction: prestige festival poster (A24 / Criterion energy) instead
 * of a glowing sign. Left-aligned serif composition in Playfair Display
 * (italic), a deep crimson velvet curtain filling the right half
 * (full-bleed backdrop on phones), thin champagne-gold hairlines.
 * - Red is the velvet + the "Lovers" wordmark gradient.
 * - Third accent: champagne gold (#e8c880 / #f3e7cd) — spine chip, rule,
 *   double-frame CTA. Never a big fill; only hairlines and small caps.
 * - A slow gold light band sweeps the folds once every ~9s (subtle enough
 *   to read as house lights, not an effect).
 *
 * Reduced motion: the sweep is hidden entirely (globals.css media query);
 * entrances become pure fades.
 */

const TRUST = [
  { icon: ShieldCheck, label: "Files never leave your devices" },
  { icon: Wifi, label: "Frame-locked playback" },
  { icon: KeyRound, label: "Invite-only, two seats" },
] as const;

export function HeroVelvet() {
  const reduceMotion = useReducedMotion() === true;
  const enter = makeEnter(reduceMotion);

  return (
    <section className="relative flex min-h-[92svh] overflow-clip">
      {/* Crimson velvet curtain — right half on desktop, backdrop on phones. */}
      <div
        aria-hidden="true"
        className="absolute inset-y-0 right-0 w-full sm:w-[56%]"
      >
        <div className="velvet-folds absolute inset-0" />
        <div className="absolute inset-0 overflow-hidden">
          <div className="velvet-sweep absolute inset-y-0 left-0 w-1/3 animate-velvet-sweep" />
        </div>
        {/* Readability ramp into the text column. */}
        <div className="absolute inset-0 bg-[linear-gradient(90deg,var(--color-abyss)_0%,rgba(5,5,5,0.72)_26%,rgba(5,5,5,0)_72%)]" />
      </div>

      {/* Gold hairline frame, top-right corner only — a printer's mark. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute right-6 top-24 hidden h-16 w-16 border-b border-r border-[#e8c880]/25 sm:block"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute bottom-28 left-6 hidden h-16 w-16 border-b border-l border-[#e8c880]/15 sm:block lg:left-12"
      />

      <div className="relative z-10 flex min-h-[92svh] w-full max-w-2xl flex-col justify-center px-6 pb-16 pt-28 sm:px-12 lg:px-16">
        {/* Spine number, Criterion-style. */}
        <motion.div {...enter(0)} className="flex items-center gap-4">
          <span className="border border-[#e8c880]/45 px-2.5 py-1 text-[10px] font-semibold tracking-[0.3em] text-[#e8c880]">
            CL—001
          </span>
          <span className="text-[10px] uppercase tracking-[0.3em] text-muted">
            Private screening
          </span>
        </motion.div>

        <h1 className="mt-9 font-serif text-[clamp(3.4rem,11vw,7.5rem)] leading-[0.95] tracking-[-0.01em]">
          <motion.span
            {...enter(0.15)}
            className="block italic text-ink"
          >
            Cinephile
          </motion.span>
          <motion.span
            {...enter(0.3)}
            className="block bg-gradient-to-r from-[#ff7a84] via-accent to-[#7a1220] bg-clip-text pr-2 italic text-transparent"
          >
            Lovers
          </motion.span>
        </h1>

        <motion.div
          {...enter(0.45)}
          aria-hidden="true"
          className="gold-rule mt-8 h-px w-24"
        />

        <motion.p
          {...enter(0.5)}
          className="mt-6 max-w-md text-sm leading-relaxed text-muted"
        >
          You each play your own copy of the movie. Files never leave your
          devices — the server only keeps the two of you in sync.
        </motion.p>

        <motion.div
          {...enter(0.65)}
          className="mt-9 flex flex-col items-start gap-5 sm:flex-row sm:items-center"
        >
          <motion.div
            whileHover={reduceMotion ? undefined : { scale: 1.02 }}
            whileTap={reduceMotion ? undefined : { scale: 0.98 }}
            transition={{ type: "spring", stiffness: 420, damping: 26 }}
          >
            {/* Double gold frame: border + offset ring. */}
            <Link
              href="/lobby"
              className="group inline-flex min-h-[52px] items-center gap-3 border border-[#e8c880]/45 px-8 text-xs font-semibold uppercase tracking-[0.3em] text-[#f3e7cd] ring-1 ring-[#e8c880]/20 ring-offset-4 ring-offset-[#050505] transition-colors duration-300 hover:border-accent hover:bg-accent hover:text-ink"
            >
              Enter the lobby
              <ArrowRight
                size={16}
                aria-hidden="true"
                className="transition-transform duration-300 group-hover:translate-x-1"
              />
            </Link>
          </motion.div>
          <Link
            href="#how"
            className="border-b border-[#e8c880]/40 pb-1 text-xs uppercase tracking-[0.24em] text-muted transition-colors hover:border-[#e8c880] hover:text-[#f3e7cd]"
          >
            How it works
          </Link>
        </motion.div>

        <motion.ul
          {...enter(0.85)}
          className="mt-12 flex flex-col items-start gap-x-6 gap-y-2 text-xs text-muted sm:flex-row"
        >
          {TRUST.map(({ icon: Icon, label }) => (
            <li key={label} className="flex items-center gap-2">
              <Icon size={14} aria-hidden="true" className="text-[#e8c880]/70" />
              {label}
            </li>
          ))}
        </motion.ul>
      </div>
    </section>
  );
}
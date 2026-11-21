"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight, KeyRound, ShieldCheck, Wifi } from "lucide-react";

import { makeEnter } from "@/components/landing/motion";
import { PereNote } from "@/components/landing/pere-note";

/*
 * HeroMarquee — M6b Variant A, "Crimson Marquee".
 *
 * Art direction: a vintage theater marquee sign floating in the dark.
 * - Red is the neon: the sign frame glows, "LOVERS" flickers like a tube
 *   with a loose contact (CSS --animate-neon-flicker).
 * - Third accent: amber (#ffb020 / #ffcf6b) — marquee bulb gold. It stays
 *   out of the headline and lives in the kicker, the chase bulbs and a
 *   faint floor halo, so the palette still reads red + black first.
 * - Bulb counts and delays are hard-coded for hydration safety.
 *
 * Reduced motion: flicker and bulb chase are clamped by the global CSS
 * media query (elements settle lit); entrances become pure fades.
 */

const TRUST = [
  { icon: ShieldCheck, label: "Files never leave your devices" },
  { icon: Wifi, label: "Frame-locked playback" },
  { icon: KeyRound, label: "Invite-only, two seats" },
] as const;

/* Fixed bulb row; delay alternates odd/even so the strip "chases". */
const BULBS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;

function BulbRow({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none flex items-center justify-between ${className ?? ""}`}
    >
      {BULBS.map((i) => (
        <span
          key={i}
          className="bulb"
          style={{ animationDelay: `${(i % 2) * 0.575}s` }}
        />
      ))}
    </div>
  );
}

export function HeroMarquee() {
  const reduceMotion = useReducedMotion() === true;
  const enter = makeEnter(reduceMotion);

  return (
    <section className="relative flex min-h-[92svh] flex-col justify-center overflow-clip px-6 pb-16 pt-28">
      {/* Neon bleed into the dark, plus a low amber floor halo. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-[46%] h-[440px] w-[min(92vw,780px)] -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent/15 blur-[120px]" />
        <div className="absolute bottom-[8%] left-1/2 h-[150px] w-[min(80vw,560px)] -translate-x-1/2 rounded-full bg-[#ffb020]/10 blur-[90px]" />
      </div>

      <div className="relative z-10 mx-auto flex w-full max-w-3xl flex-col items-center gap-7 text-center">
        <motion.p
          {...enter(0.05)}
          className="flex items-center gap-3 text-[11px] uppercase tracking-[0.42em] text-[#ffcf6b]"
        >
          <span aria-hidden="true" className="text-[9px]">
            ★
          </span>
          Now showing
          <span aria-hidden="true" className="text-[9px]">
            ★
          </span>
        </motion.p>

        {/* The sign: glowing red outer frame + dark inner face. */}
        <motion.div
          {...enter(0.18)}
          className="w-full rounded-[28px] border border-accent/45 bg-[#0c0a0b]/85 p-[6px] shadow-[0_0_0_1px_rgba(227,38,54,0.14),0_24px_110px_-24px_rgba(227,38,54,0.55)]"
        >
          <div className="relative overflow-hidden rounded-[22px] border border-white/10 px-6 pb-12 pt-14 sm:px-12">
            <BulbRow className="absolute inset-x-7 top-4" />
            <BulbRow className="absolute inset-x-7 bottom-4" />

            <h1 className="font-display text-[clamp(3.6rem,14vw,8.25rem)] leading-[0.9] tracking-[0.02em]">
              <span className="block text-ink">CINEPHILE</span>
              <span className="neon-red block animate-neon-flicker">
                LOVERS
              </span>
            </h1>

            <p className="mt-5 text-base italic tracking-wide text-soft">
              Two hearts. One screen.
            </p>

            <div className="mt-3">
              <PereNote />
            </div>

            <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-muted">
              You each play your own copy of the movie. Files never leave your
              devices — the server only keeps the two of you in sync.
            </p>
          </div>
        </motion.div>

        <motion.div
          {...enter(0.85)}
          className="flex flex-col items-center gap-3 sm:flex-row"
        >
          <motion.div
            whileHover={reduceMotion ? undefined : { scale: 1.03 }}
            whileTap={reduceMotion ? undefined : { scale: 0.97 }}
            transition={{ type: "spring", stiffness: 420, damping: 24 }}
          >
            <Link
              href="/lobby"
              className="btn-sheen group inline-flex min-h-[52px] items-center gap-2.5 rounded-full bg-btn-red px-9 text-base font-semibold text-ink shadow-[0_10px_44px_-8px_rgba(227,38,54,0.55)] transition-colors hover:bg-btn-red-deep"
            >
              Enter the lobby
              <ArrowRight
                size={18}
                aria-hidden="true"
                className="transition-transform duration-300 group-hover:translate-x-1"
              />
            </Link>
          </motion.div>
          <Link
            href="#how"
            className="inline-flex min-h-[52px] items-center rounded-full border border-line px-8 text-sm text-muted transition-colors hover:border-muted/60 hover:text-ink"
          >
            How it works
          </Link>
        </motion.div>

        {/* Ticket stub: perforated divider + admission line. */}
        <motion.div
          {...enter(1.05)}
          aria-hidden="true"
          className="flex w-full max-w-sm items-center gap-4 text-[10px] uppercase tracking-[0.34em] text-muted"
        >
          <span className="h-px flex-1 bg-[repeating-linear-gradient(to_right,var(--color-line)_0_6px,transparent_6px_12px)]" />
          Admit two
          <span className="h-px flex-1 bg-[repeating-linear-gradient(to_right,var(--color-line)_0_6px,transparent_6px_12px)]" />
        </motion.div>

        <motion.ul
          {...enter(1.15)}
          className="flex flex-col items-center gap-x-6 gap-y-2 text-xs text-muted sm:flex-row"
        >
          {TRUST.map(({ icon: Icon, label }) => (
            <li key={label} className="flex items-center gap-2">
              <Icon size={14} aria-hidden="true" className="text-soft" />
              {label}
            </li>
          ))}
        </motion.ul>
      </div>
    </section>
  );
}
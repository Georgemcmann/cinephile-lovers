"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight, KeyRound, ShieldCheck, Wifi } from "lucide-react";

import { PereNote } from "@/components/landing/pere-note";
import { ProjectorBeam } from "@/components/landing/projector-beam";
import { makeEnter } from "@/components/landing/motion";

/*
 * HeroMidnight — the original Direction B hero ("The Midnight Screening"),
 * extracted verbatim from app/page.tsx so it can live alongside the two
 * M6b variants behind the hero switcher. Warm projector beam, dust motes,
 * mask-reveal title, ember gradient on "LOVERS".
 *
 * The shared header (wordmark + INVITE ONLY chip) is rendered by the page,
 * not by this component.
 */

const TRUST = [
  { icon: ShieldCheck, label: "Files never leave your devices" },
  { icon: Wifi, label: "Frame-locked playback" },
  { icon: KeyRound, label: "Invite-only, two seats" },
] as const;

export function HeroMidnight() {
  const reduceMotion = useReducedMotion() === true;
  const enter = makeEnter(reduceMotion);

  /* Title lines rise out of a clipped mask, like curtains parting. */
  const titleLine = (delay: number) => ({
    initial: { y: reduceMotion ? "0%" : "112%" },
    animate: { y: "0%" },
    transition: { duration: reduceMotion ? 0.4 : 1.05, delay, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] },
  });

  return (
    <section className="relative flex min-h-[92svh] flex-col">
      <ProjectorBeam />

      {/* Red screen-glow pooling behind the title. */}
      <div
        aria-hidden="true"
        className="absolute left-1/2 top-[42%] h-[380px] w-[min(88vw,720px)] -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent/10 blur-[110px]"
      />

      <div className="relative z-10 flex flex-1 flex-col items-center justify-center gap-6 px-6 py-24 text-center">
        <motion.p
          {...enter(0.05)}
          className="flex items-center gap-3 text-[11px] uppercase tracking-[0.42em] text-muted"
        >
          <span aria-hidden="true" className="h-1 w-1 rounded-full bg-soft" />
          A private screening for two
          <span aria-hidden="true" className="h-1 w-1 rounded-full bg-soft" />
        </motion.p>

        <h1 className="font-display text-[clamp(4.5rem,17vw,10.5rem)] leading-[0.88] tracking-[0.02em]">
          <span className="block overflow-hidden pb-1">
            <motion.span {...titleLine(0.2)} className="block text-ink">
              CINEPHILE
            </motion.span>
          </span>
          <span className="block overflow-hidden pb-1">
            <motion.span
              {...titleLine(0.35)}
              className="block bg-gradient-to-b from-ember via-accent to-[#7a1220] bg-clip-text text-transparent animate-glow-breathe"
            >
              LOVERS
            </motion.span>
          </span>
        </h1>

        <motion.p
          {...enter(0.6)}
          className="text-base italic tracking-wide text-soft"
        >
          Two hearts. One screen.
        </motion.p>

        <motion.div {...enter(0.68)}>
          <PereNote />
        </motion.div>

        <motion.p
          {...enter(0.76)}
          className="max-w-md text-sm leading-relaxed text-muted"
        >
          You each play your own copy of the movie. Files never leave your
          devices — the server only keeps the two of you in sync.
        </motion.p>

        <motion.div
          {...enter(0.88)}
          className="mt-2 flex flex-col items-center gap-3 sm:flex-row"
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

        <motion.ul
          {...enter(1.02)}
          className="mt-8 flex flex-col items-center gap-x-6 gap-y-2 text-xs text-muted sm:flex-row"
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
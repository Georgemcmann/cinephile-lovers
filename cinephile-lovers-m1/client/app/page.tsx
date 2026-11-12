"use client";

import Link from "next/link";
import {
  motion,
  useReducedMotion,
  type Variants,
} from "framer-motion";
import {
  ArrowRight,
  KeyRound,
  MessagesSquare,
  ShieldCheck,
  Wifi,
} from "lucide-react";

import { FilmGrain } from "@/components/landing/film-grain";
import { ProjectorBeam } from "@/components/landing/projector-beam";

/*
 * Landing — Direction B, "The Midnight Screening".
 *
 * A dark theater: a warm projector beam cuts through black, dust drifts in
 * the light, the title glows like a neon marquee. Black + red only; motion
 * is cinematic (slow, eased, staggered) rather than playful.
 *
 * Pure presentation — every product behavior (create room, invite link,
 * join) lives in /lobby and the room page. This page links, it does not
 * own logic.
 *
 * Motion contract:
 * - Hero elements enter once on load with explicit delays (a fixed
 *   choreography beats nested variants for a one-shot sequence).
 * - Scroll sections reveal once via whileInView.
 * - prefers-reduced-motion: entrances become pure fades, beam sway, dust
 *   and grain stop (see globals.css media query + useReducedMotion here).
 */

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

const MARQUEE_ITEMS = [
  "NOW SHOWING",
  "TWO SEATS ONLY",
  "LOCAL FILES ONLY",
  "NOTHING UPLOADED",
  "FRAME-LOCKED SYNC",
  "MADE FOR TWO",
] as const;

const STEPS = [
  {
    num: "01",
    title: "Create a room",
    body: "One tap mints a private room with exactly two seats and an invite link that carries its own key.",
  },
  {
    num: "02",
    title: "Send the invite",
    body: "Your partner opens the link and claims the second seat. Nothing to type — the key lives inside the link itself.",
  },
  {
    num: "03",
    title: "Press play together",
    body: "You each load your own copy of the file. Play, pause and seeks stay frame-locked between you in real time.",
  },
] as const;

const FEATURES = [
  {
    icon: ShieldCheck,
    title: "Zero uploads",
    body: "Your movie is opened locally and never sent anywhere. The server relays only tiny sync commands — kilobytes, not gigabytes.",
  },
  {
    icon: Wifi,
    title: "Frame-locked playback",
    body: "A shared playback anchor with drift correction keeps both screens on the same moment — across seeks, pauses and tab switches.",
  },
  {
    icon: MessagesSquare,
    title: "Whisper chat",
    body: "A quiet, room-only chat for two. Perfect for \u201cwait — did you catch that?\u201d",
  },
] as const;

const TRUST = [
  { icon: ShieldCheck, label: "Files never leave your devices" },
  { icon: Wifi, label: "Frame-locked playback" },
  { icon: KeyRound, label: "Invite-only, two seats" },
] as const;

export default function LandingPage() {
  const reduceMotion = useReducedMotion() === true;

  /*
   * Scroll-reveal variants (how-it-works + features). Reduced motion gets
   * pure opacity fades with no positional travel.
   */
  const fadeUp: Variants = reduceMotion
    ? {
        hidden: { opacity: 0 },
        show: { opacity: 1, transition: { duration: 0.4, ease: "linear" } },
      }
    : {
        hidden: { opacity: 0, y: 28 },
        show: { opacity: 1, y: 0, transition: { duration: 0.8, ease: EASE } },
      };

  const stagger: Variants = {
    hidden: {},
    show: { transition: { staggerChildren: 0.14 } },
  };

  /* One-shot hero entrance: fade only when the OS asks for less motion. */
  const enter = (delay: number) =>
    reduceMotion
      ? {
          initial: { opacity: 0 },
          animate: { opacity: 1 },
          transition: { duration: 0.4, delay, ease: "linear" as const },
        }
      : {
          initial: { opacity: 0, y: 24 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.8, delay, ease: EASE },
        };

  /* Title lines rise out of a clipped mask, like curtains parting. */
  const titleLine = (delay: number) => ({
    initial: { y: reduceMotion ? "0%" : "112%" },
    animate: { y: "0%" },
    transition: { duration: reduceMotion ? 0.4 : 1.05, delay, ease: EASE },
  });

  return (
    <main className="relative flex flex-1 flex-col overflow-clip bg-abyss">
      <FilmGrain />

      {/* ================= HERO ================= */}
      <section className="relative flex min-h-[92svh] flex-col">
        <ProjectorBeam />

        {/* Red screen-glow pooling behind the title. */}
        <div
          aria-hidden="true"
          className="absolute left-1/2 top-[42%] h-95 w-[min(88vw,720px)] -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent/10 blur-[110px]"
        />

        <header className="relative z-10 flex items-center justify-between px-6 pt-[max(1.25rem,env(safe-area-inset-top))] sm:px-10">
          <motion.p
            {...enter(0)}
            className="flex items-center gap-2.5 font-display text-sm tracking-[0.22em] text-ink"
          >
            <span
              aria-hidden="true"
              className="inline-block h-2 w-2 rounded-full bg-soft animate-rec-pulse"
            />
            CINEPHILE LOVERS
          </motion.p>
          <motion.p
            {...enter(0.1)}
            className="rounded-full border border-line px-3 py-1.5 text-[10px] tracking-[0.28em] text-muted"
          >
            INVITE ONLY
          </motion.p>
        </header>

        <div className="relative z-10 flex flex-1 flex-col items-center justify-center gap-6 px-6 py-20 text-center">
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
                className="block bg-linear-to-b from-ember via-accent to-[#7a1220] bg-clip-text text-transparent animate-glow-breathe"
              >
                LOVERS
              </motion.span>
            </span>
          </h1>

          <motion.p
            {...enter(0.6)}
            className="italic tracking-wide text-soft"
          >
            Two hearts. One screen.
          </motion.p>

          <motion.p
            {...enter(0.72)}
            className="max-w-md text-sm leading-relaxed text-muted"
          >
            You each play your own copy of the movie. Files never leave your
            devices — the server only keeps the two of you in sync.
          </motion.p>

          <motion.div
            {...enter(0.85)}
            className="mt-2 flex flex-col items-center gap-3 sm:flex-row"
          >
            <motion.div
              whileHover={reduceMotion ? undefined : { scale: 1.03 }}
              whileTap={reduceMotion ? undefined : { scale: 0.97 }}
              transition={{ type: "spring", stiffness: 420, damping: 24 }}
            >
              <Link
                href="/lobby"
                className="btn-sheen group inline-flex min-h-13 items-center gap-2.5 rounded-full bg-btn-red px-9 text-base font-semibold shadow-[0_10px_44px_-8px_rgba(227,38,54,0.55)] transition-colors hover:bg-btn-red-deep"
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
              className="inline-flex min-h-13 items-center rounded-full border border-line px-8 text-sm text-muted transition-colors hover:border-muted/60 hover:text-ink"
            >
              How it works
            </Link>
          </motion.div>

          <motion.ul
            {...enter(1)}
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

      {/* ================= MARQUEE DIVIDER ================= */}
      <div
        aria-hidden="true"
        className="relative border-y border-line/60 py-4 mask-[linear-gradient(to_right,transparent,black_12%,black_88%,transparent)]"
      >
        <div className="flex w-max animate-marquee">
          {[0, 1].map((copy) => (
            <ul
              key={copy}
              className="flex items-center gap-8 pr-8 font-display text-sm tracking-[0.3em] text-muted"
            >
              {MARQUEE_ITEMS.map((item) => (
                <li key={item} className="flex items-center gap-8">
                  <span className="h-1 w-1 rounded-full bg-accent" />
                  {item}
                </li>
              ))}
            </ul>
          ))}
        </div>
      </div>

      {/* ================= HOW IT WORKS ================= */}
      <section
        id="how"
        className="relative z-10 mx-auto w-full max-w-5xl scroll-mt-16 px-6 py-24 sm:py-32"
      >
        <motion.div
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-80px" }}
          variants={stagger}
          className="flex flex-col gap-12"
        >
          <motion.div variants={fadeUp} className="max-w-md">
            <p className="text-[11px] uppercase tracking-[0.42em] text-soft">
              The protocol
            </p>
            <h2 className="mt-3 font-display text-4xl tracking-[0.03em] text-ink sm:text-5xl">
              THREE STEPS TO<br />THE FIRST REEL
            </h2>
          </motion.div>

          <ol className="grid grid-cols-1 gap-10 sm:grid-cols-3 sm:gap-6">
            {STEPS.map((step) => (
              <motion.li
                key={step.num}
                variants={fadeUp}
                className="relative border-t border-line pt-6"
              >
                <span
                  aria-hidden="true"
                  className="step-num font-display text-7xl leading-none"
                >
                  {step.num}
                </span>
                <h3 className="mt-4 font-semibold text-ink">
                  {step.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">
                  {step.body}
                </p>
              </motion.li>
            ))}
          </ol>
        </motion.div>
      </section>

      {/* ================= FEATURES ================= */}
      <section className="relative z-10 mx-auto w-full max-w-5xl px-6 pb-24 sm:pb-32">
        <motion.div
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-80px" }}
          variants={stagger}
          className="grid grid-cols-1 gap-4 sm:grid-cols-3"
        >
          {FEATURES.map(({ icon: Icon, title, body }) => (
            <motion.article
              key={title}
              variants={fadeUp}
              className="group rounded-2xl border border-line bg-panel/60 p-6 transition-[border-color,transform,box-shadow] duration-300 hover:-translate-y-1 hover:border-accent/60 hover:shadow-[0_18px_50px_-20px_rgba(227,38,54,0.35)]"
            >
              <Icon
                size={22}
                aria-hidden="true"
                className="text-muted transition-colors duration-300 group-hover:text-soft"
              />
              <h3 className="mt-4 font-semibold text-ink">
                {title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{body}</p>
            </motion.article>
          ))}
        </motion.div>
      </section>

      {/* ================= FOOTER ================= */}
      <footer className="relative z-10 mt-auto border-t border-line/60 px-6 pb-[max(2.5rem,env(safe-area-inset-bottom))] pt-12 text-center">
        <motion.p
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-40px" }}
          variants={fadeUp}
          className="font-display text-3xl tracking-[0.14em] text-ink"
        >
          MADE FOR TWO<span className="text-accent">.</span>
        </motion.p>
        <motion.p
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-40px" }}
          variants={fadeUp}
          className="mt-3 text-xs text-muted"
        >
          Cinephile Lovers — a screening room that fits in two pockets.
        </motion.p>
      </footer>
    </main>
  );
}
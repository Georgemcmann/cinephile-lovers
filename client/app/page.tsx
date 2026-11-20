"use client";

import { useEffect, useState } from "react";
import {
  motion,
  useReducedMotion,
  type Variants,
} from "framer-motion";
import {
  MessagesSquare,
  ShieldCheck,
  Wifi,
} from "lucide-react";

import { FilmGrain } from "@/components/landing/film-grain";
import { HeroMidnight } from "@/components/landing/hero-midnight";
import { HeroMarquee } from "@/components/landing/hero-marquee";
import { HeroVelvet } from "@/components/landing/hero-velvet";
import { EASE, makeEnter } from "@/components/landing/motion";

/*
 * Landing — Direction B, "The Midnight Screening", now hosting three hero
 * variants behind a small preview switcher:
 *
 *   midnight — the original: warm projector beam, dust, mask-reveal title
 *   marquee  — "Crimson Marquee": neon sign, flickering tube, amber bulbs
 *   noir     — "Velvet Noir": crimson velvet curtain, serif title, gold
 *
 * The switcher persists to localStorage and honors a `?hero=` query param
 * (midnight | marquee | noir) so a specific variant can be shared or
 * tested on a phone directly. It is a preview tool: delete the block
 * marked HERO SWITCHER once a direction is chosen.
 *
 * Pure presentation — every product behavior (create room, invite link,
 * join) lives in /lobby and the room page. This page links, it does not
 * own logic.
 *
 * Motion contract:
 * - Hero elements enter once on load with explicit delays.
 * - Scroll sections reveal once via whileInView.
 * - prefers-reduced-motion: entrances become pure fades; CSS loops are
 *   clamped in globals.css.
 */

type HeroVariant = "midnight" | "marquee" | "noir";

const VARIANT_ORDER: HeroVariant[] = ["midnight", "marquee", "noir"];

const VARIANT_LABELS: Record<HeroVariant, string> = {
  midnight: "Midnight",
  marquee: "Marquee",
  noir: "Noir",
};

const STORAGE_KEY = "cl-hero-variant";

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

function isHeroVariant(value: string | null): value is HeroVariant {
  return (
    value === "midnight" || value === "marquee" || value === "noir"
  );
}

export default function LandingPage() {
  const reduceMotion = useReducedMotion() === true;
  const [variant, setVariant] = useState<HeroVariant>("midnight");

  /*
   * Resolve the previewed hero: ?hero= wins (shareable/device testing),
   * then the saved choice, then the default. Effects run client-only, so
   * the server-rendered page (Midnight) and hydration stay consistent.
   */
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("hero");
    if (isHeroVariant(requested)) {
      // Client-only preview state read after hydration; the server render
      // always uses the default variant so hydration stays consistent.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setVariant(requested);
      return;
    }
    let saved: string | null = null;
    try {
      saved = window.localStorage.getItem(STORAGE_KEY);
    } catch {
      saved = null;
    }
    if (isHeroVariant(saved)) {
      setVariant(saved);
    }
  }, []);

  const pickVariant = (next: HeroVariant) => {
    setVariant(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* private mode — preview still works for this page load */
    }
  };

  /* One-shot entrance helper, shared by header + non-hero sections. */
  const enter = makeEnter(reduceMotion);

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

  return (
    <main className="relative flex flex-1 flex-col overflow-clip bg-abyss">
      <FilmGrain />

      {/* Shared header chrome, above every hero variant. */}
      <motion.header
        {...enter(0)}
        className="absolute inset-x-0 top-0 z-30 flex items-center justify-between px-6 pt-[max(1.25rem,env(safe-area-inset-top))] sm:px-10"
      >
        <p className="flex items-center gap-2.5 font-display text-sm tracking-[0.22em] text-ink">
          <span
            aria-hidden="true"
            className="inline-block h-2 w-2 rounded-full bg-soft animate-rec-pulse"
          />
          CINEPHILE LOVERS
        </p>
        <p className="rounded-full border border-line px-3 py-1.5 text-[10px] tracking-[0.28em] text-muted">
          INVITE ONLY
        </p>
      </motion.header>

      {/* ================= HERO (variant) ================= */}
      {variant === "midnight" && <HeroMidnight />}
      {variant === "marquee" && <HeroMarquee />}
      {variant === "noir" && <HeroVelvet />}

      {/* ================= MARQUEE DIVIDER ================= */}
      <div
        aria-hidden="true"
        className="relative border-y border-line/60 py-4 [mask-image:linear-gradient(to_right,transparent,black_12%,black_88%,transparent)]"
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
                <h3 className="mt-4 text-base font-semibold text-ink">
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
              <h3 className="mt-4 text-base font-semibold text-ink">
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

      {/* ================= HERO SWITCHER (preview tool) =================
          Persisted to localStorage; ?hero=midnight|marquee|noir overrides.
          Delete this whole block once a direction is chosen. */}
      <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-full border border-line bg-black/75 p-1 backdrop-blur">
        {VARIANT_ORDER.map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => pickVariant(v)}
            aria-pressed={variant === v}
            className={
              variant === v
                ? "rounded-full bg-btn-red px-3.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-ink"
                : "rounded-full px-3.5 py-1.5 text-[10px] uppercase tracking-[0.18em] text-muted transition-colors hover:text-ink"
            }
          >
            {VARIANT_LABELS[v]}
          </button>
        ))}
      </div>
    </main>
  );
}
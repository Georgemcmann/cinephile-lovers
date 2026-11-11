# Milestone 1 — Foundation

Status: **complete — verified in sandbox (desktop Chromium headless + Node 24)**. iPhone-Safari verification is intentionally deferred to the M2 prototype and the M4/M5 real-device passes (brief §13).

## Scope

What M1 contains, and deliberately does NOT contain:

| In M1 | Explicitly NOT in M1 |
| --- | --- |
| Repo scaffold, docs, gitignore | Room creation, invitations, tokens (M3) |
| Next.js client with brand tokens | Local file selection + player (M2) |
| Persistent layer + persistent-layer **spike** (the M1 gate) | Socket events, membership, chat (M4) |
| Express + Socket.IO server skeleton, health endpoint | Sync, clock model, drift correction (M5) |
| Strict origin allowlist (REST + WS), payload caps | Real UI polish, red buttons (M2/M6) |
| Zod-validated env config, graceful shutdown | Vitest tests (arrive with sync math / token code) |

## File responsibilities

### Root

| File | Responsibility |
| --- | --- |
| `README.md` | Project overview, setup commands, security posture summary, single-instance constraint note (brief §11). |
| `.gitignore` | Keeps deps, builds, env files and logs out of git; `.env.example` files stay tracked. |
| `docs/milestone-1.md` | This document: scope, responsibilities, verification. |

### client/

| File | Responsibility |
| --- | --- |
| `package.json` | Client deps only: next/react/react-dom + Tailwind/TS toolchain. No socket.io-client yet (M4), no Lucide yet (first real UI), no ESLint yet (deferred to M2 to keep M1 minimal). |
| `tsconfig.json` | Strict TS, `@/*` path alias. Next 16 normalized `jsx` to `react-jsx` and added `.next/dev/types` to `include` during first build (automatic, expected). |
| `next.config.ts` | `reactStrictMode: true` (kept ON on purpose — the brief demands StrictMode-proof effects). Security headers: `Referrer-Policy: no-referrer` (brief §6) and `X-Content-Type-Options: nosniff` on every route. |
| `postcss.config.mjs` | Tailwind v4 via `@tailwindcss/postcss`. |
| `.env.example` | `NEXT_PUBLIC_API_URL` / `NEXT_PUBLIC_SOCKET_URL` placeholders — plumbing exists before M3/M4 needs it. |
| `app/globals.css` | Tailwind import, brand tokens as `@theme` variables (bg/panel/elevated/accent/soft/ink/muted/line → utilities like `bg-panel`, `text-muted`), base typography, and the persistent dock styles. Contains the measured contrast note: white on `#e32636` is 4.19:1 (fails AA normal), so red buttons are deferred until the button-red decision. |
| `app/layout.tsx` | Root layout: metadata, dark theme color, viewport with `viewportFit: cover` (safe areas), and mounts `PersistentLayer` **above** the route tree. |
| `components/persistent-layer.tsx` | **The load-bearing file.** Owns the single `<video>` element for the whole session. Renders it in a dock whose `data-phase` (landing/lobby/watch) only changes size/visibility — never the element. Exposes `usePersistentVideo()` context. Tags the element once with a `data-spike-id` (idempotent under StrictMode). Sample URL is dev-only scaffolding removed in M2. |
| `components/spike-debug.tsx` | M1-only verification chip. Reads the element identity **from the DOM** (`dataset.spikeId`), not from React state, so the id can only change if the node was truly recreated. Shows ticking `currentTime`. Removed in M2. |
| `app/page.tsx` | Landing: title, tagline, CTA to lobby, privacy one-liner. Neutral (non-red) button per the deferred contrast decision. |
| `app/lobby/page.tsx` | Lobby placeholder + spike chip + navigation to watch room. |
| `app/room/page.tsx` | Watch Room placeholder + spike chip + navigation back. |
| `public/spike-sample.mp4` | 8-second H.264 baseline + AAC sample (120 KB) so the spike works offline with the brief's baseline codecs. Dev-only; removable in M2. |

### server/

| File | Responsibility |
| --- | --- |
| `package.json` | express 5, socket.io, zod (runtime) + tsx/typescript/@types (dev). ESM, Node ≥ 24. |
| `tsconfig.json` | Strict TS, NodeNext modules, `noUncheckedIndexedAccess`. |
| `.env.example` | `PORT`, `NODE_ENV`, `FRONTEND_URL` with comments. |
| `src/config.ts` | Zod-validated env schema; fails fast with a readable error list on bad config. |
| `src/origins.ts` | The **single source of the origin allowlist**, used by both REST and Socket.IO. Production: only `FRONTEND_URL`. Development adds localhost:3000/127.0.0.1:3000. Vercel previews are not allowed (owner decision #10). Express middleware sets CORS headers only for allowed origins; OPTIONS → 204 allowed / 403 refused. |
| `src/http/health.ts` | `GET /api/health` — minimal liveness probe, no internals leaked. |
| `src/sockets/gateway.ts` | Socket.IO attached to the same HTTP server (one port), same allowlist, `maxHttpBufferSize` 100 KB, client bundle disabled. Connection/disconnect logging only — no handshake auth, tokens or URLs are ever logged. No room/membership logic (M3/M4). |
| `src/index.ts` | Bootstrap: `trust proxy` = 1 (one hop; **must be re-verified on Render in M7**), JSON body cap 16 KB, routes, 404-minimal answer, graceful shutdown (SIGTERM/SIGINT) with failsafe timeout. |

## Verification — performed and PASSED (sandbox, 2026-11-09)

All commands below were executed against this exact code. Node 24.22.2, npm 11.19.1.

### Server

| # | Check | Command | Result |
| --- | --- | --- | --- |
| S1 | Typecheck + build clean | `npm run typecheck && npm run build` | PASS |
| S2 | Health endpoint | `curl -s http://localhost:4000/api/health` | PASS — `{"status":"ok",...}` |
| S3 | WS handshake, allowed origin | `curl -si ".../socket.io/?EIO=4&transport=polling" -H "Origin: http://localhost:3000"` | PASS — `Access-Control-Allow-Origin: http://localhost:3000`, sid issued, `maxPayload:100000` |
| S4 | WS handshake, blocked origin | same with `Origin: https://evil.example` | PASS — **no** CORS header (browser refuses) |
| S5 | REST preflight allowed / blocked | `curl -X OPTIONS .../api/health` | PASS — 204 vs 403 |
| S6 | Unknown route | `curl http://localhost:4000/api/nothing` | PASS — `404 {"error":"not_found"}` |
| S7 | Vercel-preview-style origin | `Origin: https://cinephile-git-preview.vercel.app` | PASS — no CORS header (owner decision #10 enforced) |

### Client

| # | Check | Command | Result |
| --- | --- | --- | --- |
| C1 | Install + production build | `npm install && npm run build` | PASS — 4 routes prerendered |
| C2 | Security headers served | `curl -sI http://localhost:3000/` | PASS — `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff` |

### The persistent-layer spike (the M1 gate, brief §5)

Performed in headless Chromium against the production build, reading the `<video>` element's DOM identity (`data-spike-id`) and `currentTime` before and after client-side navigation:

| Step | URL | spikeId | currentTime | paused |
| --- | --- | --- | --- | --- |
| Playback started on lobby | `/lobby` | `b8500758-f559-43a3-9e8a-a6bd6c37ec6a` | 6.28s | false |
| After navigating to watch room | `/room` | **`b8500758-f559-43a3-9e8a-a6bd6c37ec6a`** | 4.16s (looped) | false |
| 3s later on watch room | `/room` | **same** | 6.41s (advancing) | — |
| After navigating back | `/lobby` | **`b8500758-f559-43a3-9e8a-a6bd6c37ec6a`** | 7.56s | false |

Exactly **one** `<video>` element existed at every point (`videoCount: 1`). The element is the same DOM node across both navigation directions, and playback continues uninterrupted.

**Gate verdict: the persistent layer works. M2 may build on it.**

## Verified vs. assumptions

- VERIFIED (in this sandbox): everything in the tables above.
- ASSUMPTION (needs real hardware): iOS Safari behavior — muted autoplay with `playsinline`, gesture unlock, native fullscreen, backgrounding. These are exactly the M2 prototype and M4/M5 device tests.
- ASSUMPTION (needs Render): `trust proxy` = 1 correctness behind Render's actual proxy hops — M7 verification step.
- Note: headless Chromium initially blocked autoplay of the muted sample; playback was started programmatically for the spike. This is a headless-browser policy artifact, not app behavior — real-device autoplay is tested at M2.

## Run it yourself

```bash
# terminal 1
cd server && cp .env.example .env && npm install && npm run dev
# terminal 2
cd client && cp .env.example .env.local && npm install && npm run dev
# open http://localhost:3000 → lobby → watch room → lobby
# watch the [lobby]/[watch] chips: the node id must stay identical
```

# AGENTS.md

## Repository layout
- The actual app lives in `cinephile-lovers-m1/`, nested inside this git root. Run all commands from that directory.
- Two independent npm projects, no workspace/root manifest: `client/` (Next.js 16 App Router, React 19, Tailwind v4) and `server/` (Express 5, Socket.IO, Zod 4, ESM). Run `npm install` separately in each.
- `package.json` engines require Node >= 24 (README targets Node 24 LTS).
- Docs/comments cite "brief §N" for an external product brief that is not checked into this repo.

## Commands
- Server (`cinephile-lovers-m1/server`): `npm run dev` (:4000, tsx watch), `npm run typecheck`, `npm test` (Node test runner via tsx), `npm run build`, `npm start`.
- Client (`cinephile-lovers-m1/client`): `npm run dev` (:3000), `npm run lint`, `npm run build`, `npm start`.
- There is no client test script yet. For client typechecking use `npx tsc --noEmit`.
- Full M1 verification procedure (curl checks, WS origin checks, persistent-layer spike): `cinephile-lovers-m1/docs/milestone-1.md`.

## Setup gotchas
- `server/.env` is NOT auto-loaded: `tsx watch` runs without `--env-file`, so values come from the shell. Local dev works without `.env` because the Zod defaults in `src/config.ts` match `.env.example`.
- Client env lives in `client/.env.local` (Next loads it automatically). `NEXT_PUBLIC_API_URL` / `NEXT_PUBLIC_SOCKET_URL` are plumbing for later milestones, not used yet.
- `server/dist/` and `client/.next/` are generated build output; edit sources only.
- The origin allowlist is strict and centrally defined in `server/src/origins.ts`: dev allows `FRONTEND_URL` plus localhost/127.0.0.1:3000; Vercel preview URLs are intentionally rejected. Do not loosen it.

## Architecture invariants
- `client/components/persistent-layer.tsx` owns the only `<video>` element, mounted in the root layout above the route tree. It must never unmount or be recreated across navigation; route changes only flip `data-phase` on the dock. React StrictMode is intentionally on, so effects must be idempotent.
- Tailwind is v4 CSS-first: tokens are in `client/app/globals.css` under `@theme` (use utilities like `bg-panel`, `text-muted`, `bg-btn-red`; no raw hex). `--color-accent` fails WCAG AA for normal text and is for non-text UI only; red buttons use `--color-btn-red`, small red text uses `--color-soft`.
- Server uses ESM + NodeNext: relative imports in server TS require `.js` extensions (`import { loadEnv } from "./config.js"`).
- Express and Socket.IO share one HTTP server/port. All state is in-process memory; no database, single instance only, so restarts/deploys drop every room.

## Security constraints
- Never log tokens, handshake auth, invite secrets, or full URLs. Tokens travel in URL fragments / Socket.IO auth, never query strings. No cookies or accounts.
- Keep payload caps: REST JSON 16 KB, Socket.IO 100 KB.
- Enforce the origin allowlist on the actual WebSocket upgrade via Socket.IO `allowRequest`; `cors.origin` only protects HTTP polling.

## M1 scaffolding (removed in M2)
- `client/components/spike-debug.tsx`, `client/public/spike-sample.mp4`, and the `.spike-chip` styles were M1-only spike artifacts. They were removed when M2 landed; do not reintroduce them.

# Cinephile Lovers

Private, two-person watch-together web app. Each person plays their **own local copy** of a movie; files are never uploaded, stored, streamed or relayed. The backend coordinates room info, presence, playback state, sync data, chat and reactions only.

**Tagline:** Two hearts. One screen.

## Status

Milestones 1–5 are complete: persistent player foundation, local-file playback, room creation/joining, the two-person membership/session protocol, and playback synchronization (shared anchor, join catch-up, drift correction, partner-loss pause). The milestone records live in [`docs/`](docs).

## Stack

| Part | Tech |
| --- | --- |
| `client/` | Next.js (App Router) + TypeScript + Tailwind CSS, iPhone-Safari-first |
| `server/` | Node + Express + TypeScript + Socket.IO + Zod, in-memory state |
| Infra target | Vercel (client) + Render (server). No database. |

**Single-instance constraint:** rooms live in one process's memory. The backend cannot scale horizontally, and a deploy or restart ends all rooms. Accepted for MVP; the UI shows a "room has ended" screen.

## Requirements

- Node.js 24 LTS
- npm

## Setup

Backend (start this first):

```bash
cd server
npm install
npm run dev          # listens on http://localhost:4000
```

Optional configuration goes in `server/.env`, but `npm run dev` does not load it automatically — export the variables in your shell or run with `node --env-file=.env` / `tsx --env-file=.env`. The Zod defaults in `src/config.ts` match `.env.example`, so local development works without any file.

Frontend:

```bash
cd client
cp .env.example .env.local
npm install
npm run dev          # http://localhost:3000
```

## Verification

```bash
cd server
npm run typecheck
npm test                 # Vitest: unit + integration (incl. WebSocket origin)
npm run build

# with the dev server running on :4000
node scripts/verify-m4.mjs
node scripts/verify-m5.mjs

cd ../client
npm run lint
npx tsc --noEmit
npm run build
```

## Security posture (summary)

- Invite secrets travel in URL fragments and are scrubbed from the address bar immediately; they are never sent to the server in a URL. Session tokens travel in the Socket.IO handshake auth, never in query strings.
- Strict origin allowlist on REST and WebSockets, enforced on the actual WebSocket upgrade (not just polling CORS). Vercel preview URLs are deliberately not allowed (owner decision).
- No cookies, no accounts. Invite secrets and session tokens are hashed server-side and compared in constant time.
- REST stays minimal (health + room creation); membership and room state are socket-based.
- Nothing sensitive is logged: no tokens, no handshake auth, no full URLs.

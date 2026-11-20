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

Optional configuration goes in `server/.env`; `npm run dev` loads it automatically when present (`--env-file-if-exists=.env`), and exported shell variables still take precedence. The Zod defaults in `src/config.ts` match `.env.example`, so local development works without any file.

Frontend:

```bash
cd client
cp .env.example .env.local
npm install
npm run dev          # http://localhost:3000
```

### Testing on a phone with port forwarding

Forward both the frontend (`3000`) and backend (`4000`) ports, and use the
forwarded URL for each. On the phone, `localhost` refers to the phone, not
the computer running the app.

Forwarded ports default to **Private** in VS Code. A private port requires a
GitHub sign-in on every device and breaks the phone's cross-origin API calls
with "Could not reach the server". In the **Ports** panel, right-click each
port (`3000` and `4000`) -> **Port Visibility** -> **Public**. Public ports
are reachable by anyone with the URL, so only expose a dev server you trust.
If the tunnel gets stuck, run **Port Forwarding: Restart Forwarding System**
from the Command Palette; the forwarded URLs stay the same across restarts.

The client derives the backend URL from the page origin: `localhost` uses
`http://localhost:4000`, a forwarded `...-3000.<region>.devtunnels.ms` host
uses the matching `...-4000...` host, and a LAN IP uses the same host on port
`4000`. Set `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_SOCKET_URL` in
`client/.env.local` only for other deployments (they are the fallback and are
inlined at build time).

Set the server's `FRONTEND_URL` environment variable (in `server/.env`) to the
exact forwarded frontend origin (for example, `https://<forwarded-frontend-url>`);
the server uses it to allow REST and Socket.IO connections from the app.
Restart both servers after changing these values. Keep the server in
development mode for this setup.

When the dev servers restart, VS Code drops their forwarded ports; re-add
`3000` and `4000` in the Ports panel and set them back to Public.

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

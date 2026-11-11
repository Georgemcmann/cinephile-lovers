# Cinephile Lovers

Private, two-person watch-together web app. Each person plays their **own local copy** of a movie; files are never uploaded, stored, streamed or relayed. The backend coordinates room info, presence, playback state, sync data, chat and reactions only.

**Tagline:** Two hearts. One screen.

## Status

Milestone 2 — Local Video Player (in progress). The M1 foundation and its persistent-layer gate are complete; the M2 real-iPhone gate is still outstanding. Scope and the remaining checklist live in [`docs/milestone-2.md`](docs/milestone-2.md). The M1 record is in [`docs/milestone-1.md`](docs/milestone-1.md).

## Stack

| Part | Tech |
| --- | --- |
| `client/` | Next.js (App Router) + TypeScript + Tailwind CSS, iPhone-Safari-first |
| `server/` | Node + Express + TypeScript + Socket.IO + Zod, in-memory state |
| Infra target | Vercel (client) + Render (server). No database. |

**Single-instance constraint:** rooms live in one process's memory. The backend cannot scale horizontally, and a deploy or restart ends all rooms. Accepted for MVP; the UI will show a "Room lost, create a new one" screen.

## Requirements

- Node.js 24 LTS
- npm

## Setup

Backend (start this first):

```bash
cd server
cp .env.example .env
npm install
npm run dev          # listens on http://localhost:4000
```

Frontend:

```bash
cd client
cp .env.example .env.local
npm install
npm run dev          # http://localhost:3000
```

## Verification

Follow `docs/milestone-1.md` for the foundation record and `docs/milestone-2.md` for the local-player checks and the outstanding real-device gate.

## Security posture (summary)

- Invite secrets travel in URL fragments; session tokens will travel in the Socket.IO handshake auth (from M3) — never in query strings.
- Strict origin allowlist on REST and WebSockets, including the actual WebSocket upgrade (not just polling CORS). Vercel preview URLs are deliberately not allowed (owner decision).
- No cookies, no accounts. Tokens are hashed server-side and compared in constant time (from M3).
- REST stays minimal (health now, room creation later); membership is socket-based (from M3).
- Nothing sensitive is logged: no tokens, no handshake auth, no full URLs.

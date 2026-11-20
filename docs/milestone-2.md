# Milestone 2 — Local Video Player

Status: **in progress — desktop implementation verified, real-iPhone gate outstanding**.

The exact M2 wording from Master Project Brief v4 is not checked into this
repository (see `AGENTS.md`). This document records the implemented scope and
the verification that has actually been performed. It does not mark the M2
gate complete.

## Scope

| In M2 | Explicitly not in M2 |
| --- | --- |
| Local file selection through the persistent layer | Room creation, invitations, tokens (M3) |
| Object URL creation and replacement | Socket membership, presence, chat (M4) |
| Playback, pause, seek, mute and fullscreen | Server-authoritative sync (M5) |
| Resume overlay for rejected `play()` | Full journey, reconnect UX (M6) |
| Persistent-element identity check across navigation | Deployment (M7) |

## Implementation map

| File | Responsibility |
| --- | --- |
| `client/components/persistent-layer.tsx` | Owns the single `<video>`, `loadLocalFile()`, object URL lifecycle, element-event state, playback commands, resume state. |
| `client/components/file-picker.tsx` | Hidden file input; calls `loadLocalFile()` synchronously in the change event; resets the input so the same file can be chosen again. |
| `client/components/player-controls.tsx` | Play/pause, commit-on-release seek, mute, fullscreen, buffering indicator. |
| `client/components/resume-overlay.tsx` | Full-surface tap-to-play button used when `play()` is rejected. |
| `client/components/node-badge.tsx` | Displays the persistent element's DOM identity and live playback state for the M2 device check. |
| `client/app/room/page.tsx` | Mounts the file picker and controls in the watch room. |

## Verification performed — 2026-11-11

Environment: Windows, Node `22.21.0`, npm `10.9.4`, Chrome headless. The project
requires Node >= 24; the Node 24 runtime check is still outstanding.

### Static checks

| Check | Command | Result |
| --- | --- | --- |
| Client TypeScript | `npx tsc --noEmit --incremental false` | PASS |
| Client lint | `npm run lint` | PASS |
| Client production build | `npm run build` | PASS — `/`, `/lobby`, `/room` prerendered |
| Server TypeScript | `npm run typecheck` | PASS |
| Server build | `npm run build` | PASS |
| Server tests | `npm test` | PASS — 9 origin/WebSocket tests |

### Desktop browser smoke test

Performed against a fresh production build in headless Chrome using CDP:

| Step | Result |
| --- | --- |
| Load `/room` | Exactly one `<video>` element, no `src`, controls disabled |
| Select a local MP4 | Blob URL created; file status `118 KB · ready on this device` |
| Autoplay policy rejects `play()` | Resume overlay appears as a real `BUTTON` labelled “Tap to play” |
| Trusted tap on the overlay | Playback starts; overlay disappears |
| Pause button | Video pauses |
| Play button | Video resumes |
| Mute button | `video.muted` becomes true |
| Navigate to `/lobby` and back to `/room` | Same `data-node-id`; one `<video>`; playback continues and `currentTime` advances |

## Outstanding M2 gate

The following are **not** verified and must not be marked complete:

- Two real iPhones with local copies of the same movie.
- iPhone Safari file selection and object URL playback.
- iPhone user-gesture unlock / resume overlay behavior.
- Native iPhone fullscreen via `webkitEnterFullscreen`.
- Backgrounding and returning to the tab.
- Codec failure behavior on unsupported files.
- “File matching” — the v4 definition is unavailable. No filename, duration,
  size, or fingerprint matching is implemented. This requires the brief or an
  explicit owner decision before implementation.

## Run it locally

```bash
cd server && npm install && npm run dev
cd client && npm install && npm run dev
# open http://localhost:3000/room
# choose a local video, then navigate to /lobby and back
# the NodeBadge id must stay identical and playback must continue
```

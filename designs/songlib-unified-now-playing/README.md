# SongLib Amp unified playback center

This prototype is the interaction baseline for the production refactor.

Design source paths:

- `frontend/src/main.jsx`
- `frontend/src/styles.css`
- `frontend/src/commercial.css`
- `frontend/src/liquid-glass.css`
- `frontend/public/brand/songlib-amp-mark.svg`

Product decisions:

- One persistent “Now Playing” destination owns local playback, Plex sessions, lyrics, queue, remote control, and AirPlay lyrics casting.
- Every primary capability remains visible. Disabled states explain what is missing.
- Plex sessions are marked `controllable` only when the companion client is reachable and advertises playback controls; otherwise they are follow-only.
- The desktop layout uses a stable two-column media workspace. Mobile uses a five-item bottom navigation with Now Playing at the center.
- Motion is short, interruptible, and disabled by the production app when the user requests reduced motion.

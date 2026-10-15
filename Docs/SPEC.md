# Infinite Canvas: Build Spec (v1)

Working spec for the MVP: product, design, protocol, data, rendering, server, moderation, operations and build order. Companion to Infinite Canvas: Architecture and MVP Plan. Where the two differ, this document wins.

## 0. How to use this document

- This is the single source of truth. A developer or coding agent should be able to build the MVP from it without further questions.
- **DECIDED** items are fixed. **OPEN** items have a stated default: use the default and log it in `docs/DECISIONS.md`.
- Do not add features outside section 1. Park ideas in `docs/BACKLOG.md`.
- Each phase in section 14 has done-when checks. Do not start a phase until the previous one passes.
- Refinement to the architecture doc: a frozen tile is full and read-only but stays vector. It is not rasterized for display.

## 1. Product definition

**One line:** one infinite canvas that anyone can draw on, together, live.

**Core loop:** open the app, land near activity, look around, draw, see others draw live, wander, come back.

**Principles**

1. Zero friction: no login, drawing within 5 seconds of first load.
2. Always crisp: vector at every zoom.
3. Feels alive: other people's strokes appear as they are drawn.
4. Safe by default: moderation is part of the product, not an add-on.
5. Cheap to run: reads come from a CDN, writes are tiny.

**In scope (MVP):** mobile-first web app (PWA, works on desktop), one global canvas, 16-color palette, 6 brush sizes, live strokes, persistence, zoomed-out raster view, anonymous device identity, ink budget, undo own last stroke, report, activity map, discovery buttons, automated and manual moderation, admin tools.

**Out of scope:** native apps, accounts and profiles, social features, erasing others' strokes, textured brushes, layers, shapes, text, fill, monetization, multiple canvases.

## 2. Locked decisions

| Area | Decision |
| --- | --- |
| Platform | Mobile-first PWA (installable), desktop supported |
| Language | TypeScript everywhere, strict mode |
| Monorepo | pnpm workspaces: apps/web, apps/server, apps/worker, packages/shared |
| Web UI | React + Vite for UI chrome. The canvas engine is plain imperative TypeScript, not React |
| Server | Node 20+, Fastify for HTTP, ws for WebSockets |
| Database | PostgreSQL 16, plain SQL migrations (node-pg-migrate), pg client |
| Object storage | S3-compatible: MinIO locally, Cloudflare R2 in production, behind a CDN |
| Cache and pub/sub | In-memory behind interfaces for MVP. Redis implementation added when running more than one gateway |
| Rasterizer | @resvg/resvg-js renders a tile SVG, sharp encodes WebP |
| Moderation | Pluggable ModerationProvider interface. Noop provider for dev, one HTTP adapter for production (provider is OPEN) |
| Tests | Vitest for unit and integration, Playwright for e2e and visual |
| Logging and metrics | pino, prom-client |
| Local dev | docker compose (postgres, minio), one command starts everything |
| Canvas theme | The canvas is always light paper. Only the UI chrome has a dark mode |
| Persistence | Permanent (OPEN: revisit later) |
| Identity | Anonymous device token, no personal data |

## 3. Constants and coordinates

- A position is (tileX int32, tileY int32, x uint16, y uint16). Never use global floats.
- Scale means CSS pixels per tile. At DEFAULT\_SCALE one local unit is 1/32 CSS px. At MAX\_SCALE it is 0.25 CSS px, so precision is always sub-pixel.
- The world is unbounded in tile coordinates. Zoom-in depth is bounded.

| Constant | Value | Notes |
| --- | --- | --- |
| TILE\_UNITS | 65536 | Local coordinates per tile axis (uint16) |
| DEFAULT\_SCALE | 2048 | Initial zoom for drawing |
| MAX\_SCALE | 16384 | Deepest zoom in |
| MIN\_SCALE | 0.0625 | Farthest zoom out |
| VECTOR\_MIN\_SCALE | 512 | At or above this: vector mode. Below: raster mode |
| RASTER\_TILE\_PX | 1024 | Pyramid image size. Level k covers 2^k by 2^k tiles |
| PYRAMID\_MAX\_LEVEL | 12 |  |
| CELL\_PX | 512 | Render cell bitmap size in device pixels |
| BRUSH\_WIDTHS | 64, 128, 256, 512, 1024, 2048 units | 2 to 64 CSS px at default scale |
| MAX\_POINTS | 512 | Per stroke fragment, after simplification |
| SIMPLIFY\_EPSILON | 0.5 CSS px | Converted to units at capture scale |
| TILE\_STROKE\_CAP | 20000 | Then the tile is frozen |
| INK\_BURST / REFILL | 100 / 1 per 2 s | Cost per stroke: 1 + ceil(points / 64) |
| PREVIEW\_CHUNK\_MS | 50 | Client sends preview point chunks |
| BROADCAST\_BATCH\_MS | 100 | Server batches live points per tile |
| MAX\_SUBSCRIBED\_TILES | 64 | Per client |
| MAX\_LIVE\_SUBSCRIBERS\_PER\_TILE | 200 | Extra viewers get deltas only |
| MAX\_WS\_MESSAGE | 16 KB |  |
| UNDO\_WINDOW | 30 s | Own last stroke only |
| BAKE\_DEBOUNCE / MAX | 5 s / 60 s | Snapshot bake |
| PARENT\_REBAKE\_DEBOUNCE | 30 s | Pyramid levels above 0 |
| BITMAP\_CACHE | 96 MB mobile, 256 MB desktop |  |

All constants are overridable by environment variables and live in packages/shared.

## 4. Stroke format and capture

### Stroke bytes (little-endian)

```
byte 0   format version (1)
byte 1   color index 0-15
byte 2   width index 0-5
varint   point count N (1 to 512)
u16 x, u16 y   first point, tile-local units
N-1 times: zigzag varint dx, zigzag varint dy (delta from previous point)
```

### Tile snapshot file

```
magic ICT1, i32 tx, i32 ty, u32 version, varint maxStrokeId, varint strokeCount
repeated: varint strokeId, varint byteLength, stroke bytes (ascending id)
```

Stroke ids stay below 2^53 so they fit in a JS number.

### Capture pipeline (client)

1. Read coalesced pointer events and convert each to (tile, local units) using the camera.
2. Split the path at tile borders: insert the border intersection point into both fragments so each tile owns whole strokes. Round caps hide seams.
3. Simplify each fragment with Ramer-Douglas-Peucker (SIMPLIFY\_EPSILON).
4. If a fragment exceeds MAX\_POINTS, split it into consecutive fragments sharing a point.
5. While drawing, send raw quantized preview chunks every PREVIEW\_CHUNK\_MS (relay only, never stored).
6. On pen up, quantize and encode the simplified fragment and send it as the commit. Only the commit is stored.

Smoothing happens only at render time. Stored points are the simplified raw points.

## 5. Network protocol

### HTTP (JSON unless noted)

- POST /api/session: create or resume an anonymous user. Returns token, userId, limits, rulesVersion.
- POST /api/rules/accept: record acceptance of the rules version.
- POST /api/tile-index: body is up to 64 tiles. Returns per tile: version, snapshot url, maxStrokeId, strokeCount, frozen.
- GET snapshot url: immutable, cacheable vector snapshot (binary).
- GET /raster/{level}/{x}/{y}.webp?v={version}: immutable raster tile. 404 means blank paper.
- GET /api/spawn: a suggested start (tile, offset, scale) near recent activity.
- GET /api/activity: busiest cells in the last hour for the map overlay.
- POST /api/report: tile, point, reason, optional note.
- /admin/api/\*: see section 10 (admin token required).

### WebSocket

Binary, little-endian. The first byte is the message type. A tile is i32 tx, i32 ty.

| Type | Direction | Payload |
| --- | --- | --- |
| 0x01 HELLO | client | token, client version |
| 0x02 SUBSCRIBE | client | count, then per tile: tile, sinceStrokeId (varint), live flag (u8) |
| 0x03 UNSUBSCRIBE | client | count, tiles |
| 0x04 STROKE\_BEGIN | client | clientStrokeId u32, tile, color u8, width u8 |
| 0x05 STROKE\_PREVIEW | client | clientStrokeId, delta-encoded points (relay only) |
| 0x06 STROKE\_COMMIT | client | clientStrokeId, full stroke bytes (this is what is stored) |
| 0x07 STROKE\_CANCEL | client | clientStrokeId |
| 0x08 UNDO | client | serverStrokeId |
| 0x0F PING | client | none |
| 0x81 WELCOME | server | userId, limits, ink state, serverTime, readOnly flag |
| 0x82 TILE\_DELTA | server | tile, count, then per stroke: id, bytes |
| 0x83 LIVE\_BEGIN | server | tile, liveId u32, color, width |
| 0x84 LIVE\_POINTS | server | liveId, delta-encoded points |
| 0x85 LIVE\_END | server | liveId, serverStrokeId (0 if discarded) |
| 0x86 STROKE\_ACK | server | clientStrokeId, serverStrokeId, ink state |
| 0x87 STROKE\_REJECT | server | clientStrokeId, error code |
| 0x88 STROKES\_HIDDEN | server | tile, stroke ids |
| 0x89 TILE\_FROZEN | server | tile |
| 0x8A INK | server | ink state |
| 0x8B NOTICE | server | code, text |
| 0x8F PONG | server | none |

Rules:

- Client sends HELLO first. Reconnect with exponential backoff (1 s to 30 s, with jitter), then HELLO and SUBSCRIBE again using sinceStrokeId so nothing is missed.
- Previews are optional and lossy. Only STROKE\_COMMIT creates a stroke. A commit is idempotent per (connection, clientStrokeId).
- Error codes are in Appendix B.

## 6. Data model

```
users(id uuid pk, token_hash bytea unique, created_at, last_seen_at,
      trust int default 0, banned bool default false, rules_version int)

strokes(id bigserial pk, tile_x int, tile_y int, user_id uuid,
        created_at timestamptz, status smallint default 0, data bytea)
  -- status: 0 visible, 1 hidden by moderator, 2 quarantined by auto-scan, 3 undone by author
  -- index (tile_x, tile_y, id), index (user_id, created_at)

tiles(tile_x int, tile_y int, stroke_count int, frozen bool,
      snapshot_version int, snapshot_key text, max_stroke_id bigint,
      dirty_since timestamptz, primary key (tile_x, tile_y))

raster_tiles(level smallint, x int, y int, version int, key text,
             primary key (level, x, y))

reports(id, created_at, reporter uuid, tile_x, tile_y, x, y, reason,
        note, status, resolved_by, resolved_at)

mod_actions(id, created_at, admin, action, target jsonb)

bake_jobs(id, kind, tile_x, tile_y, level, run_after, attempts, locked_at)
```

The bake queue lives in Postgres (bake\_jobs, claimed with SKIP LOCKED) so no extra infrastructure is needed.

## 7. Client: UX and visual design

### Screens and states

1. **First run:** three short cards (what this is, how to draw, the rules), then an Accept button. The accepted rules version is stored with the user. Drawing is possible only after accepting.
2. **Canvas (main):** full-screen canvas. Bottom toolbar respecting safe-area insets: color button, brush size button, undo, draw/move toggle, ink meter. Top-right: map button, report button. Top-left: info button (rules, about).
3. **Color popover:** 4x4 swatch grid (Appendix A). **Size popover:** six dots at true relative size.
4. **Map overlay:** activity heatmap of cells near you, a Busy spot button and a Random spot button, tap a cell to jump there.
5. **Report sheet:** tap the area on the canvas, pick a reason (sexual, hateful, violent, personal information, spam, other), optional note, send.
6. **System states:** connecting, offline banner with retry, read-only mode (kill switch) with message, ink empty (toast with refill countdown), tile full (toast: this area is full, try nearby), banned (full-screen message).

### Gestures

- Draw mode (default): one finger draws, two fingers pan and pinch-zoom.
- Move mode: one finger pans, two fingers pinch-zoom.
- Desktop: left-drag draws, Space+drag or middle-drag pans, wheel zooms around the cursor, Ctrl/Cmd+Z undoes.
- Use Pointer Events with coalesced events. Ignore large-contact touches while a pen is active (palm rejection).
- Disable browser gestures on the canvas: touch-action none, overscroll-behavior none.

### Visual design

- Canvas background: warm paper #FBFAF7 in every theme.
- UI chrome: translucent surface with blur, 16 px radius, 1 px hairline border, soft shadow. Light: surface #FFFFFF at 90%, text #1A1A1A. Dark: surface #1E1E22 at 90%, text #F2F2F2.
- Accent #5B5BD6. Destructive #E53935.
- System UI font stack, 14 and 16 px sizes.
- Touch targets at least 44 px. Motion 150 ms ease-out, disabled under prefers-reduced-motion.
- Brush preview: a circle at true brush size follows the pointer on desktop and flashes on touch start.
- Other people's live strokes render identically to your own. No names, no cursors.
- Accessibility: every control labeled, visible focus rings, swatches have text names (for example Red), AA contrast for chrome.
- All strings in a single i18n file so Hindi can be added later. English first.

## 8. Client: rendering engine

### Camera and modes

- Camera = tile (two int32) + offset within the tile (float64 in 0 to 1 per axis) + scale. Convert pointer positions to tile + local units. No global floats.
- scale >= VECTOR\_MIN\_SCALE: vector mode. Otherwise raster mode. Crossfade 150 ms across the threshold.

### Vector mode: render cells

- Let zq = ceil(log2(scale \* devicePixelRatio)). A render cell is a 512x512 device-pixel bitmap covering a 512 / 2^zq fraction of a tile on each axis. Cache key: (tx, ty, zq, cellX, cellY).
- For each visible cell not in the cache, draw the intersecting strokes into an OffscreenCanvas (plain canvas if unavailable) and cache it. Blit cells to the screen at scale factor scale \* dpr / 2^zq (between 0.5 and 1).
- While pinching, keep blitting cached cells. When the gesture has settled for 150 ms, rebuild cells for the new zq.
- LRU cache bounded by BITMAP\_CACHE. Evict non-visible cells first.
- Each loaded tile gets a 16x16 grid index of strokes so a cell only iterates relevant strokes.
- Draw order is ascending stroke id.

### Drawing a stroke

- Smooth with Catmull-Rom converted to cubic Bezier through the stored points. Round caps and joins. A single point is a filled circle.
- Skip strokes whose width and extent are under 0.5 device px at the current zq.

### Raster mode

- Pyramid level k = clamp(floor(log2(1024 / (scale \* dpr))), 0, 12).
- Fetch versioned raster URLs, keep decoded ImageBitmaps in an LRU. A 404 is blank paper.

### Live layer and optimistic drawing

- Your in-progress stroke and others' live strokes draw on a transparent overlay canvas above the cells and redraw every frame while active.
- Your stroke shows immediately. On ACK it joins the tile data and the affected cells are invalidated. On REJECT it fades out and a toast explains why.

### Performance

- requestAnimationFrame with a dirty flag. Target 60 fps pan and zoom on a mid-range Android phone, under 8 ms of JS per frame while panning.

## 9. Server

### Modules

- **session:** anonymous users, hashed tokens (SHA-256 of 32 random bytes), rules acceptance.
- **gateway:** WebSockets, per-tile subscription registry, fan-out.
- **strokes:** validate, persist, assign ids.
- **ink:** token-bucket limiter per user.
- **tiles:** snapshot index, stroke counts, freezing.
- **bake:** job runner for snapshots, rasters, pyramid, moderation scans.
- **moderation:** provider interface, quarantine logic.
- **admin:** reports and actions API.
- **config:** feature flags, including the global read-only kill switch.

### Commit validation (reject with a code)

- Tile not frozen (TILE\_FULL). Server not read-only (READ\_ONLY). User not banned (BANNED).
- Color 0-15, width 0-5, points 1-512, coordinates within 0-65535, declared size matches actual, deltas stay inside the tile (BAD\_STROKE).
- Ink available (INK\_EMPTY). Per-user and per-IP rate limits (RATE\_LIMIT).
- A duplicate clientStrokeId on the same connection is ignored and re-ACKed.
- Previews: at most 8 open at once, at most 4 KB per second per connection, only for tiles the client is subscribed to. Violations drop the preview, not the connection.

### Fan-out

- The registry maps tile to subscribers. Previews go only to subscribers with live=1.
- Batch outgoing live points every BROADCAST\_BATCH\_MS per tile.
- If a client's send buffer exceeds 1 MB, drop live frames for that client.
- A committed stroke goes to every subscriber of the tile as TILE\_DELTA.

### Persistence and snapshots

- A commit appends to strokes, increments tiles.stroke\_count and sets dirty\_since. At TILE\_STROKE\_CAP, set frozen and broadcast TILE\_FROZEN.
- Bake job per dirty tile: after BAKE\_DEBOUNCE of quiet (max BAKE\_MAX), write a vector snapshot to object storage at an immutable key, update snapshot\_version and max\_stroke\_id, then enqueue the raster bake.
- Raster bake: build an SVG from the tile's visible strokes, rasterize at 1024x1024, encode WebP, store at level 0. Then enqueue parent levels up to 12 (debounced), each composed from its four children.
- Snapshots contain visible strokes only (status 0).

### Undo and reliability

- UNDO works on your own most recent stroke within UNDO\_WINDOW. Sets status 3, broadcasts STROKES\_HIDDEN, refunds ink, marks the tile dirty.
- Writes are transactional. Graceful shutdown drains sockets. Clients resubscribe with sinceStrokeId after any reconnect.
- Kill switch: a config flag puts the server in read-only mode. WELCOME carries the flag and commits get READ\_ONLY.

## 10. Moderation and admin

### Automated

- After each tile snapshot bake, render a 512 px preview and call ModerationProvider.scan(image). The result is flagged, categories, score.
- If flagged: mark strokes created since the tile's last clean scan as quarantined (status 2), rebake, and add a review item. Quarantined strokes are invisible to everyone except admins.
- Strokes from new devices (trust 0) are scanned first in the bake queue.
- Provider failures never block drawing: log, retry with backoff, alert if the queue grows.

### Reports

- A report stores tile, point, reason and reporter.
- Three or more distinct reporters in the same area within an hour auto-quarantine recent strokes there (threshold configurable) and raise review priority.

### Admin tool (route /admin in the web app, token protected)

- **Review queue:** shows the area rendered with and without quarantined strokes, the stroke list with authors, and actions: restore, hide, ban user.
- **Tile viewer:** browse any tile, with a per-user overlay.
- **Bulk actions:** hide by user, tile, region rectangle or time range. Each is a status change plus a rebake and is logged in mod\_actions.
- **Users:** ban or limit a device, adjust trust.
- **Dashboard:** strokes per minute, active users, open reports, queue depth, flagged rate.
- **Kill switch** toggle.

### Rules text (shown in onboarding)

No sexual content, hate, graphic violence, harassment, personal information, advertising or spam. Moderators may remove anything. Reports are anonymous.

## 11. Security, privacy, legal

- Tokens: random 32 bytes, stored hashed. Sent in the WebSocket HELLO and an Authorization header for HTTP.
- Limits: session creation per IP, max connections per IP, max message size 16 KB, ping timeout 30 s, strict validation on every binary message.
- Admin: a separate long random token from the environment, HTTPS only, optional IP allowlist. No admin routes on the public CDN host.
- CORS limited to the app origin. Content-Security-Policy on the web app.
- Privacy: no names, emails or phone numbers collected. IP addresses only in short-lived rate-limit counters and abuse logs, retained 30 days. The privacy policy must say exactly this.
- Minimum age: stated in the Terms (OPEN, default 13+).
- Legal, needs a lawyer before public launch: Terms of Service, takedown process, grievance contact, and the intermediary obligations that apply in India. App stores require report, block and takedown mechanisms for user-generated content.
- Secrets live only in environment variables, never in the repo.

## 12. Observability

- Structured logs (pino) with request and user ids. No stroke content in logs.
- Metrics (prom-client, /metrics protected): open connections, subscribers per tile (top N), strokes per second, rejects by code, commit-to-ack latency, bake queue depth and duration, moderation flagged rate, WebSocket bytes out.
- Health: /healthz (liveness) and /readyz (database and storage reachable).
- Alerts: queue depth growing, p95 ack latency over 500 ms, error-rate spike, storage nearing limits.
- Optional: Sentry for client and server errors.

## 13. Repo, environment, deployment

```
infinite-canvas/
  apps/web/        React + Vite PWA, canvas engine in src/engine
  apps/server/     Fastify + ws gateway, admin API
  apps/worker/     bake and moderation workers
  packages/shared/ constants, codec, geometry, protocol types
  docs/            SPEC.md, ARCHITECTURE.md, DECISIONS.md, BACKLOG.md
  infra/           docker-compose.yml, Caddyfile, migrations/
  scripts/         dev helpers, load-test bot swarm
```

- One command runs everything locally: pnpm dev (docker compose for postgres and minio, then web, server and worker).
- Scripts: pnpm test, pnpm test:e2e, pnpm lint, pnpm migrate, pnpm loadtest.
- Environment variables: DATABASE\_URL, S3\_ENDPOINT, S3\_BUCKET, S3\_ACCESS\_KEY, S3\_SECRET\_KEY, CDN\_BASE\_URL, ADMIN\_TOKEN, MODERATION\_PROVIDER, MODERATION\_API\_KEY, PUBLIC\_ORIGIN, READ\_ONLY, plus every constant in section 3.
- Production: one VPS in a region near users (Mumbai or Bangalore if the beta is in India), Docker, Caddy for TLS, Postgres with nightly backups, Cloudflare R2 plus CDN for tiles. A staging environment mirrors production.
- Backups: nightly pg\_dump to object storage, 14 days retention, restore tested before launch. Object storage versioning on.
- CI: lint, typecheck, unit and integration tests on every push, e2e on main.

## 14. Build phases and acceptance criteria

**Phase 0: Spike (2-3 days)**

- Pan and zoom canvas, vector strokes with simplify and smoothing, tile-local coordinates, render cells with cache. No server.
- Done when: strokes stay crisp from MIN\_SCALE to MAX\_SCALE, pan holds 60 fps on a mid-range phone, and the cache stays under budget during a 2-minute stress pan.

**Phase 1: Shared core and realtime**

- packages/shared codec and constants, gateway, Postgres persistence, session, subscribe, previews, commit, ACK and REJECT, reconnect.
- Done when: two browsers see each other's strokes live within 500 ms p95, strokes survive a server restart, and codec round-trip tests pass.

**Phase 2: Snapshots, CDN, raster pyramid**

- Bake worker, snapshots, raster levels, tile-index endpoint, LOD switching with crossfade.
- Done when: a cold client loads visible tiles in under 300 ms p95 locally, zooming out to the world view shows raster tiles with no visible pop, and snapshot plus delta is always consistent.

**Phase 3: Limits and identity**

- Palette and width limits, ink, rate limits, tile cap and freezing, undo, onboarding with rules.
- Done when: abuse tests (flooding, oversize strokes, bad coordinates) are rejected with the right codes, ink refills correctly, and a frozen tile rejects strokes.

**Phase 4: Moderation and admin**

- Provider interface and adapter, quarantine flow, report flow, admin tool, kill switch.
- Done when: a flagged test image quarantines recent strokes and they vanish for users, an admin can restore them, bulk-hide a region and ban a device, and every action is logged.

**Phase 5: Discovery and polish**

- Spawn placement, activity endpoint, map overlay, busy and random buttons, empty states, PWA install, performance and accessibility passes.
- Done when: a new user lands near activity and draws within 5 seconds, Lighthouse PWA and accessibility checks pass, and every state in section 7 exists.

**Phase 6: Beta hardening**

- Load test, backup and restore drill, dashboards, production deploy, closed beta of 50-200 users.
- Done when: the load test holds 1,000 simulated clients (including a hotspot of 200 in one tile) within latency targets, the restore drill succeeds, and the launch checklist is complete.

## 15. Test plan

- **Unit:** stroke codec round-trip (1 point, 512 points, extreme deltas), tile splitting at borders, simplification, ink limiter, camera math with no precision loss far from the origin, LOD level selection.
- **Integration:** WebSocket flows (subscribe, draw, ack, every reject code, undo, reconnect with sinceStrokeId), snapshot plus delta consistency, freezing at the cap, quarantine and restore.
- **E2E (Playwright):** two browser contexts where one draws and the other sees it, zoom in and out, report flow, admin hide.
- **Visual regression:** screenshot a fixed set of strokes at several scales and pixel ratios against baselines to catch blur or seams at tile borders.
- **Load:** a Node bot swarm that connects, subscribes to viewports and draws at human rates. Scenarios: 1,000 spread users, and 1,000 users with 200 in one hot tile. Track ack latency, CPU, memory, bytes out.
- **Device matrix:** mid-range Android, recent iPhone, low-end Android, desktop Chrome and Safari.

## 16. Launch checklist

- Terms of Service and privacy policy published, rules shown in onboarding.
- Report flow tested end to end, including auto-quarantine.
- Moderation provider tested on a sample set that includes adversarial drawings.
- Admin tools used by a second person, not just the builder.
- Kill switch tested in production.
- Rate limits and ink tuned from beta data.
- Load test passed, backup restore tested, dashboards and alerts live.
- Takedown and support contact monitored.
- Rollback plan for the previous deploy written and rehearsed.

## 17. Open decisions and defaults

| Question | Default |
| --- | --- |
| Product name and branding | Working title Infinite Canvas |
| Persistence | Permanent |
| Erasing | Undo own last stroke only, 30 s window |
| Tile stroke cap | 20,000 |
| Moderation provider | A cloud image moderation API, chosen after testing sample renders |
| Minimum age | 13+ |
| Analytics | Simple, privacy-friendly event counts, no personal data |
| Native wrapper | Later, Capacitor |
| Accounts | None in MVP |
| Time-based mechanics (resets, seasons) | None in MVP |

## Appendix A: Palette

| Index | Name | Hex |
| --- | --- | --- |
| 0 | Black | #1A1A1A |
| 1 | Gray | #6B6B6B |
| 2 | White | #FFFFFF |
| 3 | Red | #E53935 |
| 4 | Orange | #FB8C00 |
| 5 | Yellow | #FDD835 |
| 6 | Green | #7CB342 |
| 7 | Teal | #00897B |
| 8 | Blue | #1E88E5 |
| 9 | Indigo | #3949AB |
| 10 | Purple | #8E24AA |
| 11 | Pink | #D81B60 |
| 12 | Brown | #8D6E63 |
| 13 | Peach | #F4C7A1 |
| 14 | Sky | #81D4FA |
| 15 | Mint | #A5D6A7 |

## Appendix B: Error codes

| Code | Name | Meaning |
| --- | --- | --- |
| 1 | RATE\_LIMIT | Too many requests |
| 2 | INK\_EMPTY | Ink budget exhausted |
| 3 | TILE\_FULL | Tile is frozen at the stroke cap |
| 4 | BAD\_STROKE | Failed validation |
| 5 | OUT\_OF\_RANGE | Tile or coordinates not allowed |
| 6 | BANNED | User is banned |
| 7 | READ\_ONLY | Server is in read-only mode |
| 8 | SERVER\_BUSY | Temporary overload, retry later |
| 9 | UNAUTHORIZED | Missing or invalid token |

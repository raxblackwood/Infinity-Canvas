# Project Memory: Infinite Canvas

This document is the definitive context, architecture, progress, and handoff guide for Infinite Canvas.
It allows any incoming AI assistant or human engineer to resume work immediately with zero ambiguity.

---

## 1. Project Vision and Core Principles

Infinite Canvas is an unbounded, shared, real-time collaborative digital canvas.
Anyone on the web can open the application and draw together instantly with vector-sharp precision at every zoom level.

### Core Loop
A user opens the canvas, lands near recent activity, looks around, draws strokes, watches others draw live, explores the infinite plane, and returns later.

### Non-Negotiable Product Principles
1. **Zero Friction**:
No mandatory login, signup, or email collection.
Drawing begins within seconds of accepting community rules.
2. **Always Crisp**:
Strokes remain vector representations across all zoom levels.
There are no blurred strokes when zooming in.
3. **Alive and Collaborative**:
Remote strokes stream live as they are being drawn.
End-to-end synchronization target is under 500 ms p95.
4. **Safe by Default**:
Integrated moderation is built directly into the core product rather than added as an afterthought.
Automated image scanning, user reporting, and quarantine queues protect users.
5. **Cost-Efficient**:
The realtime gateway is lean and never rasterizes images.
Heavier snapshot baking, pyramid generation, and safety scanning run asynchronously in background workers.

---

## 2. Workspace Structure and Monorepo Layout

The repository is configured as a `pnpm` monorepo with strict TypeScript throughout.

```
/
├── apps/
│   ├── web/           # React 18 + Vite client UI and imperative CanvasEngine
│   ├── server/        # Fastify HTTP server + ws WebSocket realtime gateway
│   └── worker/        # Asynchronous rasterizer, pyramid generator, and bake worker
├── packages/
│   └── shared/        # Isomorphic coordinates, binary protocol, geometry, and codecs
├── infra/
│   └── migrations/    # Plain PostgreSQL SQL migrations (node-pg-migrate compatible)
├── e2e/               # Playwright end-to-end and visual regression test suite
├── Docs/              # System specifications, architecture records, and memory
└── scripts/           # Swarm load testing, backup drills, and administrative tools
```

---

## 3. Implementation Status and Phase Breakdown

All primary development phases (Phase 0 through Phase 6) are 100% complete, fully verified, and committed.

### Phase 0: Client Core and Imperative Vector Engine
- Implemented `CanvasEngine`, `CanvasRenderer`, `Camera`, `PointerCapture`, and `SpatialIndex`.
- Pure imperative rendering pipeline on HTML5 2D Canvas without React rendering loops.
- Camera model tracks `(tileX, tileY, offsetX, offsetY, scale)`.
- Implemented Ramer-Douglas-Peucker (RDP) point simplification and Catmull-Rom to cubic Bezier curve rendering.
- Fully verified vector crispness across DPR 1, 2, and 3 at scale stops 512, 1024, 2048, 8192, and 16384.

### Phase 1: Realtime Synchronization and Gateway
- Fastify server with binary WebSocket gateway.
- Binary protocol supporting `HELLO`, `WELCOME`, `SUBSCRIBE`, `STROKE_COMMIT`, `STROKE_ACK`, and `TILE_DELTA`.
- Sub-500 ms live streaming via `STROKE_BEGIN`, `STROKE_PREVIEW`, `LIVE_POINTS`, and `LIVE_END`.
- Spatial tile subscription management with automatic viewport tracking.
- Verified live multi-client synchronization across isolated browser contexts.

### Phase 2: Snapshots, CDN, and Raster Pyramid LOD
- Custom binary tile snapshot format `ICT1` with varint coordinate packing.
- S3/MinIO compatible object store for tile snapshots and WebP image storage.
- Background `BakeWorker` converts tile strokes to SVG and encodes Level 0-4 WebP pyramids via `@resvg/resvg-js` and `sharp`.
- Seamless 150 ms crossfade between vector cells and raster pyramid overview.
- Outdated Phase 0 placeholder eliminated; scale below 512 smoothly displays vector cells down to zq 9.

### Phase 3: Hardening, Limits, and Abuse Prevention
- Dynamic stroke ink cost: $1 + \lceil\text{points}/64\rceil$.
- Leaky bucket ink rate limiter: capacity 100 tokens, refilling at 0.5 tokens/second (+1 token every 2 seconds).
- Per-tile stroke cap of 20,000 strokes; full tiles freeze permanently as read-only vector art.
- 30-second undo window allowing creators to undo their own latest strokes, refunding spent ink tokens.
- Global emergency read-only kill switch toggleable without restarting servers.
- IP rate limiter and WebSocket handshake throttling.

### Phase 4: Moderation and Admin Tooling
- Pluggable `ModerationProvider` architecture with local Noop provider and cloud HTTP adapter.
- Automated post-bake moderation scanning with image quarantine capabilities.
- User reporting interface supporting single-tile and multi-tile drag-selection reporting.
- Threshold-based auto-quarantine (3+ distinct reports within 1 hour triggers immediate quarantine).
- Comprehensive `AdminDashboard` protected by bearer token authentication.
- Administrative controls for review queue triage, bulk tile wiping, user banning, and immutable audit logging.

### Phase 5: Discovery, Export, and Polish
- Smart spawn endpoint `GET /api/spawn` landing newcomers near active canvas drawings.
- In-canvas 5x5 activity radar and heatmap overlay with jump buttons.
- High-resolution exporter generating PNGs (1x, 2x, 4x) and clean standalone vector SVGs.
- Deep linking with debounced URL hash updates: `#t=tileX,tileY@scale`.
- Installable PWA manifest, scalable vector application icons, and offline service worker.
- First-run onboarding flow with 3 rule cards and explicit terms acceptance.

### Phase 6: Load Testing, Observability, and Operations
- Health probe endpoints `GET /healthz` and `GET /readyz`.
- Prometheus metrics endpoint `GET /metrics` reporting connection counts, stroke commit latencies, and queue depths.
- 1,000-bot swarm load test script (`scripts/loadtest-swarm.ts`) verifying p95 latency of 83 ms under extreme concurrency.
- Zero-data-loss backup and restore drill (`scripts/backup-restore-drill.ts`) with SHA-256 verification.

### UI Polish and Toolbar Modernization
- Developer HUD (`PerformanceHUD`) hidden from production view; accessible via `H` key or `?debug=1`.
- Clean Apple/Linear-inspired floating glass toolbar at bottom center.
- Lucide-style inline SVG icons replacing all emoji placeholders.
- Segmented pill toggle for Draw (`✏️`) versus Move/Pan (`✋`) modes.
- Color popover (16 palette swatches) and brush size popover (6 widths) with click-outside dismissal.
- Top-left header pill: Rules (`btn-info`) and Admin (`btn-admin`).
- Top-right header pill: Map (`btn-map`), Export (`btn-export`), Share (`btn-share`), and Report (`btn-report`).

---

## 4. Fundamental Invariants and Coordinate Math

Any AI modifying the codebase must preserve these mathematical invariants.

1. **No Global Floating-Point Coordinates**:
Global space is partitioned into a discrete 2D grid of tiles indexed by `(tileX int32, tileY int32)`.
Within each tile, coordinates are strictly `uint16` integers from `0` to `65535` (`TILE_UNITS = 65536`).
Camera position is represented as:
- `tileX` (int32)
- `tileY` (int32)
- `offsetX` (float64 in range [0, 1))
- `offsetY` (float64 in range [0, 1))
- `scale` (CSS pixels per tile)
2. **Sub-Pixel Precision**:
At `DEFAULT_SCALE` (2048 px/tile), 1 local tile unit equals 1/32 CSS pixel.
At `MAX_SCALE` (16384 px/tile), 1 local tile unit equals 0.25 CSS pixel.
Precision never degrades even when billions of tiles away from origin.
3. **Frozen Tiles Remain Vector**:
When a tile reaches 20,000 strokes, it is marked `frozen = true`.
Frozen tiles reject new strokes, but remain rendered as vector data when viewed at vector scale.
They are never downgraded to raster images in vector viewing modes.
4. **Lean Realtime Server Path**:
The gateway server in `apps/server` never parses SVG, never rasterizes pixels, and never holds canvas contexts.
It only validates coordinates, verifies ink budgets, writes stroke rows, and fans out binary messages.

---

## 5. Testing and Verification Protocols

Both unit and end-to-end test suites are in a 100% passing state.
Every code change must maintain this standard.

### Vitest Unit Tests
Run command: `pnpm exec vitest run`
Current state: **55 passed out of 55 tests across 11 test suites**.
Covers:
- Binary codecs, varints, and zigzag integer encoding.
- `ICT1` snapshot serialize and deserialize logic.
- Coordinate wrapping, camera math, and boundary normalization.
- RDP simplification and Catmull-Rom spline decomposition.
- Ink rate limiter, stroke caps, and undo mechanics.
- Server REST endpoints, WebSocket handshakes, and moderation rules.
- Worker raster pipeline and WebP header validation.

### Playwright End-to-End Tests
Run command: `pnpm test:e2e`
Current state: **30 passed out of 30 tests**.
Covers:
- Snapshots, cold client loading, and vector-to-raster crossfade.
- Real-time ink consumption, stroke undo, and read-only kill switches.
- Tile reporting, multi-tile drag-selection, and admin dashboard operations.
- Onboarding modal, deep linking, map overlay, and image exports.
- Multi-client live synchronization.
- 17 visual regression tests across DPR 1, 2, and 3 at scale stops 512, 1024, 2048, 8192, and 16384.

### Critical Playwright Test Caveats
- `playwright.config.ts` pre-accepts rules via `storageState` for the default browser context.
- Tests creating fresh contexts via `browser.newContext()` must call `page.addInitScript(() => localStorage.setItem('rules_accepted_v1', 'true'))` to prevent the onboarding modal from blocking clicks.
- Tests interacting with the developer HUD must navigate with `page.goto('/?debug=1')`.
- All `data-testid` attributes on toolbar buttons and modals are strictly asserted by tests and must not be altered.

---

## 6. Remote Repository and Deployment Status

### GitHub Repository
- Remote URL: `https://github.com/raxblackwood/Infinity-Canvas.git`
- Active Branches: `main` (default) and `master` (both synchronized and up to date).

### Deployment Architecture
The application cannot run on static web hosts such as GitHub Pages because it requires a persistent WebSocket gateway and PostgreSQL database.
Recommended production options:
1. **Cloud VPS (Hetzner / DigitalOcean - ~$3.80 to $5/month)**:
Run PostgreSQL 16, MinIO, Server, Worker, and Web frontend in Docker containers with Caddy providing automatic SSL.
Offers the highest performance and zero cold starts.
2. **Managed Cloud (Railway / Render - $0 to $5/month)**:
Connects directly to the GitHub repository.
Railway runs the Node server and managed PostgreSQL with automatic continuous deployment on `git push`.

---

## 7. Working Rules for Future AI Assistants

The following behavioral rules must always be obeyed when modifying this repository:

1. **Plain Dashes Only**:
Never use the em dash character.
Always use the plain dash "-" instead.
2. **Sentence-Per-Line Markdown**:
When writing or editing long Markdown files, place each full sentence on its own physical line.
Avoid wrapping multiple sentences onto one physical line.
3. **No Co-Author Attribution in Commits**:
When creating git commit messages, never auto-add your AI agent name as a co-author.
4. **Preserve Auto-Generated Files**:
Never manually modify `CHANGELOG.md` or any file explicitly marked as auto-generated.
5. **Quality Over Development Cost**:
When making technical decisions, prioritize architectural simplicity, robustness, scalability, and long-term maintainability over quick shortcuts.
6. **Reproduce Bugs in End-to-End Context**:
Always reproduce bugs in an end-to-end setting closely aligned with real user behavior before applying fixes.
7. **Zero Tolerance for Test Flakiness**:
Maintain high engineering standards.
If any test failure or lint error appears, address it immediately.

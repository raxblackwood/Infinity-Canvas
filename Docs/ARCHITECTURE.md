# Infinite Canvas: Architecture & MVP Plan (Companion)

This document provides architectural background for the Infinite Canvas MVP.
> **Single Source of Truth**: Where this document differs from `docs/SPEC.md`, `docs/SPEC.md` wins.

---

## 1. System Overview

Infinite Canvas is an unbounded collaborative canvas rendered in vector format at all drawing scales, with a zoomed-out raster pyramid for wide overviews.

```
                          +------------------------+
                          |   Browser (PWA / Web)  |
                          |  - React UI Chrome     |
                          |  - Plain TS Engine     |
                          +-----------+------------+
                                      |
                     HTTP (Snapshots) | WS (Live / Commits)
                                      v
       +-------------------------------------------------------------+
       |                     apps/server Gateway                     |
       |  - Fastify (Sessions, Rules, Tile Index, Report, Admin API) |
       |  - WebSocket Gateway (Binary protocol, HELLO, Fan-out)      |
       |  - Ink Limiter, Validation, Read-only Kill Switch           |
       +-------------------+---------------------+-------------------+
                           |                     |
                  Read / Write              SKIP LOCKED
                           v                     v
                +--------------------+   +-------------------+
                |    PostgreSQL 16   |   |   apps/worker     |
                | - strokes          |   | - Snapshot Bake   |
                | - tiles            |   | - Raster Pyramid  |
                | - bake_jobs queue  |   | - Moderation Scan |
                +--------------------+   +---------+---------+
                                                   |
                                              Put Objects
                                                   v
                                         +-------------------+
                                         | S3 / MinIO / R2   |
                                         | - Vector snapshot |
                                         | - WebP raster LOD |
                                         +-------------------+
```

---

## 2. Core Architectural Principles & Invariants

1. **No Global Floating-Point World Coordinates**:
   - The world is partitioned into a discrete 2D grid of tiles indexed by `(tileX int32, tileY int32)`.
   - Within each tile, coordinate positions are represented strictly in `uint16` local units `(0 to 65535)` where `TILE_UNITS = 65536`.
   - Camera state is defined as `tile (int32, int32) + offset (float64 in [0, 1) per axis) + scale (CSS px per tile)`.
   - Precision is always sub-pixel (`1/32` CSS px at `DEFAULT_SCALE`, `0.25` CSS px at `MAX_SCALE`).

2. **Realtime Path is Lean**:
   - The server gateway never renders, rasterizes, or holds pixel buffers.
   - It only validates binary stroke packets, increments counters, appends to the database, manages ink token buckets, and fans out binary messages to active tile subscribers.
   - All rasterization and image moderation occur asynchronously in `apps/worker`.

3. **Frozen Tiles Stay Vector**:
   - When a tile reaches `TILE_STROKE_CAP` (20,000 strokes), it is marked `frozen = true`.
   - Frozen tiles reject further incoming strokes, but remain full vector representations when viewed at or above `VECTOR_MIN_SCALE`. They are not replaced with raster images for display in vector zoom levels.

4. **Strict Binary Protocol & Validation**:
   - All client-to-server WebSocket messages are strictly validated before acceptance.
   - Violations are rejected with explicit error codes (`BAD_STROKE`, `INK_EMPTY`, `TILE_FULL`, `RATE_LIMIT`, `READ_ONLY`, `BANNED`).
   - Stroke fragments are simplified on the client (RDP) and validated on the server.

5. **Integrated Safety & Moderation**:
   - Automated post-bake moderation scans (pluggable `ModerationProvider`).
   - Quarantining hides flagged strokes from non-admin viewers immediately.
   - Anonymous device identity with trust scoring and report clustering.
   - Global read-only kill switch enforced at both gateway handshake and commit validation.

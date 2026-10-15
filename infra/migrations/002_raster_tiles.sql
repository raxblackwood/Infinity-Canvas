-- Migration: 002_raster_tiles.sql
-- Infinite Canvas: Raster Tiles and Bake Queue (SPEC Section 6)

CREATE TABLE IF NOT EXISTS raster_tiles (
  level SMALLINT NOT NULL,
  x INT NOT NULL,
  y INT NOT NULL,
  version INT NOT NULL DEFAULT 1,
  key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (level, x, y)
);

CREATE TABLE IF NOT EXISTS bake_jobs (
  id BIGSERIAL PRIMARY KEY,
  kind TEXT NOT NULL, -- 'snapshot', 'raster_level_0', 'raster_parent'
  tile_x INT NOT NULL,
  tile_y INT NOT NULL,
  level SMALLINT DEFAULT 0,
  run_after TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  attempts INT NOT NULL DEFAULT 0,
  locked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_bake_jobs_claim ON bake_jobs (run_after, attempts) WHERE locked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_raster_tiles_lookup ON raster_tiles (level, x, y);

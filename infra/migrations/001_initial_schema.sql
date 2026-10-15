-- Migration: 001_initial_schema.sql
-- Infinite Canvas: Initial Data Model (SPEC Section 6)

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  token_hash BYTEA UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  trust INT DEFAULT 0,
  banned BOOL DEFAULT false,
  rules_version INT DEFAULT 0
);

CREATE TABLE IF NOT EXISTS tiles (
  tile_x INT NOT NULL,
  tile_y INT NOT NULL,
  stroke_count INT DEFAULT 0,
  frozen BOOL DEFAULT false,
  snapshot_version INT DEFAULT 0,
  snapshot_key TEXT,
  max_stroke_id BIGINT DEFAULT 0,
  dirty_since TIMESTAMPTZ,
  PRIMARY KEY (tile_x, tile_y)
);

CREATE TABLE IF NOT EXISTS strokes (
  id BIGSERIAL PRIMARY KEY,
  tile_x INT NOT NULL,
  tile_y INT NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status SMALLINT DEFAULT 0, -- 0 visible, 1 hidden by mod, 2 quarantined, 3 undone
  data BYTEA NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_strokes_tile_id ON strokes (tile_x, tile_y, id);
CREATE INDEX IF NOT EXISTS idx_strokes_user_created ON strokes (user_id, created_at);

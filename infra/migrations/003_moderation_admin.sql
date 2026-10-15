-- Migration: 003_moderation_admin.sql
-- Infinite Canvas: Moderation, Reports, and Admin Audit Logging (SPEC Section 6 & 10)

CREATE TABLE IF NOT EXISTS reports (
  id BIGSERIAL PRIMARY KEY,
  tile_x INT NOT NULL,
  tile_y INT NOT NULL,
  point_x INT NOT NULL DEFAULT 32768,
  point_y INT NOT NULL DEFAULT 32768,
  user_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reason TEXT NOT NULL,
  note TEXT,
  status SMALLINT NOT NULL DEFAULT 0 -- 0 open, 1 actioned, 2 dismissed
);

CREATE INDEX IF NOT EXISTS idx_reports_tile_created ON reports (tile_x, tile_y, created_at);
CREATE INDEX IF NOT EXISTS idx_reports_user ON reports (user_id);

CREATE TABLE IF NOT EXISTS review_queue (
  id BIGSERIAL PRIMARY KEY,
  tile_x INT NOT NULL,
  tile_y INT NOT NULL,
  flagged_reason TEXT NOT NULL,
  stroke_count INT NOT NULL DEFAULT 0,
  priority INT NOT NULL DEFAULT 0, -- 5 automated, 10 user report threshold
  status SMALLINT NOT NULL DEFAULT 0, -- 0 pending, 1 resolved
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_review_queue_pending ON review_queue (status, priority DESC, created_at ASC);

CREATE TABLE IF NOT EXISTS mod_actions (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  admin_user TEXT NOT NULL,
  action TEXT NOT NULL, -- 'quarantine', 'restore', 'hide_stroke', 'bulk_hide', 'ban_user', 'unban_user'
  target_type TEXT NOT NULL, -- 'stroke', 'tile', 'region', 'user'
  target_id TEXT NOT NULL,
  reason TEXT,
  metadata JSONB
);

CREATE INDEX IF NOT EXISTS idx_mod_actions_created ON mod_actions (created_at DESC);

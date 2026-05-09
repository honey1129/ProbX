CREATE TABLE IF NOT EXISTS indexed_events (
  id VARCHAR(120) NOT NULL PRIMARY KEY,
  signature VARCHAR(128) NOT NULL,
  slot BIGINT UNSIGNED NOT NULL DEFAULT 0,
  event_type VARCHAR(32) NOT NULL,
  created_at BIGINT NOT NULL,
  UNIQUE KEY idx_indexed_events_signature_type (signature, event_type, id),
  KEY idx_indexed_events_slot (slot),
  KEY idx_indexed_events_created_at (created_at)
);

CREATE TABLE IF NOT EXISTS indexer_state (
  name VARCHAR(64) NOT NULL PRIMARY KEY,
  cursor_signature VARCHAR(128) NOT NULL,
  cursor_slot BIGINT UNSIGNED NOT NULL DEFAULT 0,
  updated_at BIGINT NOT NULL
);

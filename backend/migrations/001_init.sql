CREATE TABLE IF NOT EXISTS markets (
  id VARCHAR(96) NOT NULL PRIMARY KEY,
  public_key VARCHAR(96) NOT NULL,
  creator VARCHAR(96) NOT NULL,
  resolver VARCHAR(96) NOT NULL,
  question VARCHAR(280) NOT NULL,
  category VARCHAR(32) NOT NULL,
  avatar_url MEDIUMTEXT NULL,
  yes_pool DOUBLE NOT NULL DEFAULT 0,
  no_pool DOUBLE NOT NULL DEFAULT 0,
  total_liquidity DOUBLE NOT NULL DEFAULT 0,
  volume_24h DOUBLE NOT NULL DEFAULT 0,
  participants INT NOT NULL DEFAULT 0,
  change_24h DOUBLE NOT NULL DEFAULT 0,
  end_time BIGINT NOT NULL,
  resolved BOOLEAN NOT NULL DEFAULT FALSE,
  outcome TINYINT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  UNIQUE KEY idx_markets_public_key (public_key),
  KEY idx_markets_end_time (end_time),
  KEY idx_markets_resolver (resolver),
  KEY idx_markets_category (category)
);

CREATE TABLE IF NOT EXISTS probability_points (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  market_id VARCHAR(96) NOT NULL,
  probability DOUBLE NOT NULL,
  recorded_at BIGINT NOT NULL,
  KEY idx_probability_points_market_time (market_id, recorded_at),
  CONSTRAINT fk_probability_points_market
    FOREIGN KEY (market_id) REFERENCES markets(id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS positions (
  id VARCHAR(120) NOT NULL PRIMARY KEY,
  owner VARCHAR(96) NOT NULL,
  market_id VARCHAR(96) NOT NULL,
  side VARCHAR(8) NOT NULL,
  size DOUBLE NOT NULL DEFAULT 0,
  entry_probability DOUBLE NOT NULL DEFAULT 0,
  current_probability DOUBLE NOT NULL DEFAULT 0,
  pnl DOUBLE NOT NULL DEFAULT 0,
  resolved BOOLEAN NOT NULL DEFAULT FALSE,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  UNIQUE KEY idx_positions_owner_market_side (owner, market_id, side),
  KEY idx_positions_owner (owner),
  CONSTRAINT fk_positions_market
    FOREIGN KEY (market_id) REFERENCES markets(id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS trades (
  id VARCHAR(120) NOT NULL PRIMARY KEY,
  owner VARCHAR(96) NOT NULL,
  market_id VARCHAR(96) NOT NULL,
  side VARCHAR(8) NOT NULL,
  amount_sol DOUBLE NOT NULL,
  price DOUBLE NOT NULL,
  signature VARCHAR(128) NOT NULL,
  status VARCHAR(32) NOT NULL,
  created_at BIGINT NOT NULL,
  KEY idx_trades_market_time (market_id, created_at),
  KEY idx_trades_owner_time (owner, created_at),
  CONSTRAINT fk_trades_market
    FOREIGN KEY (market_id) REFERENCES markets(id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS agent_activity (
  id VARCHAR(120) NOT NULL PRIMARY KEY,
  agent VARCHAR(96) NOT NULL,
  market_id VARCHAR(96) NOT NULL,
  side VARCHAR(8) NOT NULL,
  action VARCHAR(12) NOT NULL,
  size DOUBLE NOT NULL,
  confidence INT NOT NULL,
  timestamp_ms BIGINT NOT NULL,
  KEY idx_agent_activity_time (timestamp_ms),
  KEY idx_agent_activity_market_time (market_id, timestamp_ms),
  CONSTRAINT fk_agent_activity_market
    FOREIGN KEY (market_id) REFERENCES markets(id)
    ON DELETE CASCADE
);

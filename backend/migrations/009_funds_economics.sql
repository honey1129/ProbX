SET @market_protocol_config_column_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'markets'
    AND COLUMN_NAME = 'protocol_config'
);

SET @market_protocol_config_column_sql = IF(
  @market_protocol_config_column_exists = 0,
  'ALTER TABLE markets ADD COLUMN protocol_config VARCHAR(96) NOT NULL DEFAULT '''' AFTER resolver',
  'SELECT 1'
);
PREPARE market_protocol_config_column_stmt FROM @market_protocol_config_column_sql;
EXECUTE market_protocol_config_column_stmt;
DEALLOCATE PREPARE market_protocol_config_column_stmt;

SET @market_treasury_column_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'markets'
    AND COLUMN_NAME = 'treasury'
);

SET @market_treasury_column_sql = IF(
  @market_treasury_column_exists = 0,
  'ALTER TABLE markets ADD COLUMN treasury VARCHAR(96) NOT NULL DEFAULT '''' AFTER protocol_config',
  'SELECT 1'
);
PREPARE market_treasury_column_stmt FROM @market_treasury_column_sql;
EXECUTE market_treasury_column_stmt;
DEALLOCATE PREPARE market_treasury_column_stmt;

SET @market_protocol_fee_bps_column_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'markets'
    AND COLUMN_NAME = 'protocol_fee_bps'
);

SET @market_protocol_fee_bps_column_sql = IF(
  @market_protocol_fee_bps_column_exists = 0,
  'ALTER TABLE markets ADD COLUMN protocol_fee_bps INT NOT NULL DEFAULT 100 AFTER treasury',
  'SELECT 1'
);
PREPARE market_protocol_fee_bps_column_stmt FROM @market_protocol_fee_bps_column_sql;
EXECUTE market_protocol_fee_bps_column_stmt;
DEALLOCATE PREPARE market_protocol_fee_bps_column_stmt;

SET @market_creator_lp_shares_column_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'markets'
    AND COLUMN_NAME = 'creator_lp_shares'
);

SET @market_creator_lp_shares_column_sql = IF(
  @market_creator_lp_shares_column_exists = 0,
  'ALTER TABLE markets ADD COLUMN creator_lp_shares DOUBLE NOT NULL DEFAULT 0 AFTER protocol_fee_bps',
  'SELECT 1'
);
PREPARE market_creator_lp_shares_column_stmt FROM @market_creator_lp_shares_column_sql;
EXECUTE market_creator_lp_shares_column_stmt;
DEALLOCATE PREPARE market_creator_lp_shares_column_stmt;

SET @market_protocol_fees_column_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'markets'
    AND COLUMN_NAME = 'protocol_fees'
);

SET @market_protocol_fees_column_sql = IF(
  @market_protocol_fees_column_exists = 0,
  'ALTER TABLE markets ADD COLUMN protocol_fees DOUBLE NOT NULL DEFAULT 0 AFTER creator_lp_shares',
  'SELECT 1'
);
PREPARE market_protocol_fees_column_stmt FROM @market_protocol_fees_column_sql;
EXECUTE market_protocol_fees_column_stmt;
DEALLOCATE PREPARE market_protocol_fees_column_stmt;

SET @market_residual_withdrawn_column_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'markets'
    AND COLUMN_NAME = 'residual_withdrawn'
);

SET @market_residual_withdrawn_column_sql = IF(
  @market_residual_withdrawn_column_exists = 0,
  'ALTER TABLE markets ADD COLUMN residual_withdrawn DOUBLE NOT NULL DEFAULT 0 AFTER protocol_fees',
  'SELECT 1'
);
PREPARE market_residual_withdrawn_column_stmt FROM @market_residual_withdrawn_column_sql;
EXECUTE market_residual_withdrawn_column_stmt;
DEALLOCATE PREPARE market_residual_withdrawn_column_stmt;

SET @market_residual_claimed_column_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'markets'
    AND COLUMN_NAME = 'residual_claimed'
);

SET @market_residual_claimed_column_sql = IF(
  @market_residual_claimed_column_exists = 0,
  'ALTER TABLE markets ADD COLUMN residual_claimed BOOLEAN NOT NULL DEFAULT FALSE AFTER residual_withdrawn',
  'SELECT 1'
);
PREPARE market_residual_claimed_column_stmt FROM @market_residual_claimed_column_sql;
EXECUTE market_residual_claimed_column_stmt;
DEALLOCATE PREPARE market_residual_claimed_column_stmt;

UPDATE markets
SET creator_lp_shares = total_liquidity
WHERE creator_lp_shares = 0;

SET @market_treasury_index_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'markets'
    AND INDEX_NAME = 'idx_markets_treasury'
);

SET @market_treasury_index_sql = IF(
  @market_treasury_index_exists = 0,
  'CREATE INDEX idx_markets_treasury ON markets (treasury)',
  'SELECT 1'
);
PREPARE market_treasury_index_stmt FROM @market_treasury_index_sql;
EXECUTE market_treasury_index_stmt;
DEALLOCATE PREPARE market_treasury_index_stmt;

SET @trade_action_column_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'trades'
    AND COLUMN_NAME = 'action'
);

SET @trade_action_column_sql = IF(
  @trade_action_column_exists = 0,
  'ALTER TABLE trades ADD COLUMN action VARCHAR(12) NOT NULL DEFAULT ''BUY'' AFTER side',
  'SELECT 1'
);
PREPARE trade_action_column_stmt FROM @trade_action_column_sql;
EXECUTE trade_action_column_stmt;
DEALLOCATE PREPARE trade_action_column_stmt;

SET @trade_net_amount_column_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'trades'
    AND COLUMN_NAME = 'net_amount_sol'
);

SET @trade_net_amount_column_sql = IF(
  @trade_net_amount_column_exists = 0,
  'ALTER TABLE trades ADD COLUMN net_amount_sol DOUBLE NOT NULL DEFAULT 0 AFTER amount_sol',
  'SELECT 1'
);
PREPARE trade_net_amount_column_stmt FROM @trade_net_amount_column_sql;
EXECUTE trade_net_amount_column_stmt;
DEALLOCATE PREPARE trade_net_amount_column_stmt;

SET @trade_protocol_fee_column_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'trades'
    AND COLUMN_NAME = 'protocol_fee_sol'
);

SET @trade_protocol_fee_column_sql = IF(
  @trade_protocol_fee_column_exists = 0,
  'ALTER TABLE trades ADD COLUMN protocol_fee_sol DOUBLE NOT NULL DEFAULT 0 AFTER net_amount_sol',
  'SELECT 1'
);
PREPARE trade_protocol_fee_column_stmt FROM @trade_protocol_fee_column_sql;
EXECUTE trade_protocol_fee_column_stmt;
DEALLOCATE PREPARE trade_protocol_fee_column_stmt;

UPDATE trades
SET net_amount_sol = amount_sol
WHERE net_amount_sol = 0;

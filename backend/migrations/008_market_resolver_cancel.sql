SET @market_resolver_column_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'markets'
    AND COLUMN_NAME = 'resolver'
);

SET @market_resolver_column_sql = IF(
  @market_resolver_column_exists = 0,
  'ALTER TABLE markets ADD COLUMN resolver VARCHAR(96) NOT NULL DEFAULT '''' AFTER creator',
  'SELECT 1'
);

PREPARE market_resolver_column_stmt FROM @market_resolver_column_sql;
EXECUTE market_resolver_column_stmt;
DEALLOCATE PREPARE market_resolver_column_stmt;

UPDATE markets
SET resolver = creator
WHERE resolver = '';

SET @market_resolver_index_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'markets'
    AND INDEX_NAME = 'idx_markets_resolver'
);

SET @market_resolver_index_sql = IF(
  @market_resolver_index_exists = 0,
  'CREATE INDEX idx_markets_resolver ON markets (resolver)',
  'SELECT 1'
);

PREPARE market_resolver_index_stmt FROM @market_resolver_index_sql;
EXECUTE market_resolver_index_stmt;
DEALLOCATE PREPARE market_resolver_index_stmt;

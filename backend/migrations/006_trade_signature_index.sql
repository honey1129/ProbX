SET @trade_signature_index_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'trades'
    AND INDEX_NAME = 'idx_trades_signature'
);

SET @trade_signature_index_sql = IF(
  @trade_signature_index_exists = 0,
  'CREATE INDEX idx_trades_signature ON trades (signature)',
  'SELECT 1'
);

PREPARE trade_signature_index_stmt FROM @trade_signature_index_sql;
EXECUTE trade_signature_index_stmt;
DEALLOCATE PREPARE trade_signature_index_stmt;

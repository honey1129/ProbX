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

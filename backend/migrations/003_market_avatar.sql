SET @avatar_column_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'markets'
    AND COLUMN_NAME = 'avatar_url'
);

SET @avatar_column_sql = IF(
  @avatar_column_exists = 0,
  'ALTER TABLE markets ADD COLUMN avatar_url MEDIUMTEXT NULL AFTER category',
  'SELECT 1'
);

PREPARE avatar_column_stmt FROM @avatar_column_sql;
EXECUTE avatar_column_stmt;
DEALLOCATE PREPARE avatar_column_stmt;

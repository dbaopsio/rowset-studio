-- Rows captured before an UPDATE or DELETE, so they can be restored. The
-- statement and the rows are stored encrypted.
CREATE TABLE row_backups (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  connection_id TEXT NOT NULL,
  database_name TEXT NOT NULL DEFAULT '',
  schema_name TEXT NOT NULL DEFAULT '',
  table_name TEXT NOT NULL,
  kind TEXT NOT NULL,
  row_count INTEGER NOT NULL,
  ciphertext BLOB NOT NULL,
  nonce BLOB NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX row_backups_user_created ON row_backups(user_id, created_at DESC);

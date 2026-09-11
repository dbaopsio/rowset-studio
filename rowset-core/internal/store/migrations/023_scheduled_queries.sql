-- Queries run on a schedule by their owner; the SQL is stored encrypted.
CREATE TABLE scheduled_queries (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  connection_id TEXT NOT NULL,
  database_name TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  ciphertext BLOB NOT NULL,
  nonce BLOB NOT NULL,
  schedule TEXT NOT NULL,
  output_dir TEXT NOT NULL,
  output_format TEXT NOT NULL,
  catch_up INTEGER NOT NULL DEFAULT 1,
  enabled INTEGER NOT NULL DEFAULT 1,
  next_run_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX scheduled_queries_due ON scheduled_queries(enabled, next_run_at);

CREATE TABLE scheduled_query_runs (
  id TEXT PRIMARY KEY,
  query_id TEXT NOT NULL REFERENCES scheduled_queries(id) ON DELETE CASCADE,
  trigger TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL,
  row_count INTEGER NOT NULL DEFAULT 0,
  output_path TEXT,
  error TEXT
);
CREATE INDEX scheduled_query_runs_query ON scheduled_query_runs(query_id, started_at DESC);

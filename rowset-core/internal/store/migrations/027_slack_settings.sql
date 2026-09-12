-- Where this workspace posts notifications. The webhook address is kept
-- encrypted, like any other secret.
CREATE TABLE slack_settings (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  ciphertext BLOB NOT NULL,
  nonce BLOB NOT NULL,
  schedule_runs TEXT NOT NULL DEFAULT 'failures',
  long_query_seconds INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

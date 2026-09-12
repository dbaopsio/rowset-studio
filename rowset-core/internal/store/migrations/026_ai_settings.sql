-- How this workspace reaches an AI assistant: a provider key, kept
-- encrypted like any other secret, or a command-line tool on this computer.
CREATE TABLE ai_settings (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT '',
  ciphertext BLOB,
  nonce BLOB,
  share_schema INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

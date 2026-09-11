CREATE TABLE workspaces (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL CHECK (revision > 0),
  ciphertext BLOB NOT NULL,
  nonce BLOB NOT NULL
);

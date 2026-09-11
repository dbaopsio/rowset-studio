CREATE TABLE notebooks (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL CHECK (revision > 0),
  ciphertext BLOB NOT NULL,
  nonce BLOB NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX notebooks_user_updated ON notebooks(user_id, updated_at);
-- Records the one-time conversion of a user's saved queries into a notebook.
CREATE TABLE notebook_imports (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  imported_at TEXT NOT NULL
);

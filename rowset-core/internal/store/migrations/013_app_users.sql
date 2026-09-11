ALTER TABLE users ADD COLUMN user_type TEXT NOT NULL DEFAULT 'human'
  CHECK(user_type IN ('human', 'app'));
ALTER TABLE users ADD COLUMN username TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_org_username
  ON users(org_id, username)
  WHERE username IS NOT NULL;

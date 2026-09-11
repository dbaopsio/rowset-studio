CREATE TABLE IF NOT EXISTS login_failures (
  email TEXT PRIMARY KEY,
  fail_count INTEGER NOT NULL,
  last_failed_at TEXT NOT NULL
);

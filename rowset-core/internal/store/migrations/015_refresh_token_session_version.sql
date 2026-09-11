ALTER TABLE refresh_tokens
  ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0;

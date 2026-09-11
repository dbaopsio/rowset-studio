-- Hot-path lookup indexes: query history panel, per-user audit filters and
-- refresh-token rotation.
CREATE INDEX IF NOT EXISTS idx_query_history_user_conn
  ON query_history(user_id, connection_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_user_created
  ON audit_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user
  ON refresh_tokens(user_id);

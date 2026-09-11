CREATE INDEX IF NOT EXISTS idx_query_history_user_conn_created
  ON query_history(user_id, connection_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_saved_queries_user_created
  ON saved_queries(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_revoked
  ON refresh_tokens(user_id, revoked);

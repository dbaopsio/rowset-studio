-- User-defined policies instantiated from enforcement templates (kind):
--   deny_table              config = table name
--   deny_statement          config = insert|update|delete|ddl
--   max_rows                config = row count
-- connection_id/role_name NULL = applies to all connections/roles.
CREATE TABLE IF NOT EXISTS custom_policies (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  config TEXT NOT NULL,
  connection_id TEXT,
  role_name TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_custom_policies_org ON custom_policies(org_id);

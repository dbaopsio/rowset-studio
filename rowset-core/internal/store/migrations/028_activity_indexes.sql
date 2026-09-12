-- Every audit write reads the newest entry of its organization to extend the
-- hash chain. An index on org_id alone is ordered by rowid within each
-- organization, so that read is a single step instead of a sort of every
-- entry the organization has ever written.
CREATE INDEX IF NOT EXISTS idx_audit_org_chain ON audit_logs(org_id);

-- A person's history across all of their connections is listed newest first.
CREATE INDEX IF NOT EXISTS idx_query_history_user_created ON query_history(user_id, created_at);

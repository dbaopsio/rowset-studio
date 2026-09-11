package store

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"strconv"
	"strings"

	"github.com/dbaopsio/rowset-studio/rowset-core/internal/domain"
)

const currentAuditHashVersion int64 = 2

func auditHash(version int64, previous string, item domain.AuditLog) string {
	values := []string{previous, item.ID, item.UserID, item.OrgID, item.ConnectionID, item.QueryHash, item.StartedAt, item.PolicyDecision, item.Reference}
	if version == 2 {
		values = append(values, item.SQL, item.ErrorMessage, item.ClientIP, optionalNumber(item.RowsReturned, item.RowsReturnedSet), optionalNumber(item.RowsAffected, item.RowsAffectedSet))
	}
	sum := sha256.Sum256([]byte(strings.Join(values, "|")))
	return hex.EncodeToString(sum[:])
}

func PrepareAudit(previous string, item domain.AuditLog) domain.AuditLog {
	item.PreviousHash = previous
	item.HashVersion = currentAuditHashVersion
	item.EntryHash = auditHash(item.HashVersion, item.PreviousHash, item)
	return item
}

func VerifyPreparedAudit(version int64, previous, expected string, item domain.AuditLog) bool {
	return (version == 1 || version == currentAuditHashVersion) && auditHash(version, previous, item) == expected
}
func optionalNumber(value int64, set bool) string {
	if !set {
		return ""
	}
	return strconv.FormatInt(value, 10)
}

// auditReferenceColumn names the column that stores AuditLog.Reference; the
// reference is not stored when it is empty.
var auditReferenceColumn string

func (s *Store) WriteAudit(ctx context.Context, item domain.AuditLog) error {
	s.auditMu.Lock()
	defer s.auditMu.Unlock()
	var previous sql.NullString
	if item.OrgID != "" {
		_ = s.db.QueryRowContext(ctx, "SELECT entry_hash FROM audit_logs WHERE org_id=? AND entry_hash IS NOT NULL ORDER BY rowid DESC LIMIT 1", item.OrgID).Scan(&previous)
	}
	item = PrepareAudit(previous.String, item)
	columns := "id,user_id,org_id,role,connection_id,sql,normalized_sql,query_hash,client_type,client_ip,user_agent,started_at,duration_ms,rows_returned,rows_affected,policy_decision,policy_reason,policy_id,error_message,created_at,prev_hash,entry_hash,hash_version"
	args := []any{item.ID, nullText(item.UserID), nullText(item.OrgID), nullText(item.Role), nullText(item.ConnectionID), nullText(item.SQL), nullText(item.NormalizedSQL), nullText(item.QueryHash), nullText(item.ClientType), nullText(item.ClientIP), nullText(item.UserAgent), nullText(item.StartedAt), item.DurationMS, nullableNumber(item.RowsReturned, item.RowsReturnedSet), nullableNumber(item.RowsAffected, item.RowsAffectedSet), nullText(item.PolicyDecision), nullText(item.PolicyReason), nullText(item.PolicyID), nullText(item.ErrorMessage), item.CreatedAt, nullText(item.PreviousHash), item.EntryHash, item.HashVersion}
	if auditReferenceColumn != "" {
		columns += "," + auditReferenceColumn
		args = append(args, nullText(item.Reference))
	}
	_, err := s.db.ExecContext(ctx, "INSERT INTO audit_logs("+columns+") VALUES("+strings.TrimSuffix(strings.Repeat("?,", len(args)), ",")+")", args...)
	return mapError(err)
}
func nullText(value string) any {
	if value == "" {
		return nil
	}
	return value
}
func nullableNumber(value int64, set bool) any {
	if !set {
		return nil
	}
	return value
}

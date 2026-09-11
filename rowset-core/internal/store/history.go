package store

import (
	"context"
	"database/sql"

	"github.com/dbaopsio/rowset-studio/rowset-core/internal/domain"
)

func (s *Store) ListSavedQueries(ctx context.Context, userID string) ([]domain.SavedQuery, error) {
	rows, err := s.db.QueryContext(ctx, "SELECT id,org_id,user_id,connection_id,name,sql,created_at FROM saved_queries WHERE user_id=? ORDER BY created_at DESC", userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var result []domain.SavedQuery
	for rows.Next() {
		var item domain.SavedQuery
		if err := rows.Scan(&item.ID, &item.OrgID, &item.UserID, &item.ConnectionID, &item.Name, &item.SQL, &item.CreatedAt); err != nil {
			return nil, err
		}
		result = append(result, item)
	}
	return result, rows.Err()
}
func (s *Store) CreateSavedQuery(ctx context.Context, item domain.SavedQuery) error {
	_, err := s.db.ExecContext(ctx, "INSERT INTO saved_queries(id,org_id,user_id,connection_id,name,sql,created_at) VALUES(?,?,?,?,?,?,?)", item.ID, item.OrgID, item.UserID, item.ConnectionID, item.Name, item.SQL, item.CreatedAt)
	return mapError(err)
}
func (s *Store) DeleteSavedQuery(ctx context.Context, id, userID string) error {
	result, err := s.db.ExecContext(ctx, "DELETE FROM saved_queries WHERE id=? AND user_id=?", id, userID)
	if err != nil {
		return err
	}
	return requireChanged(result)
}

func (s *Store) CreateQueryHistory(ctx context.Context, item domain.QueryHistory) error {
	_, err := s.db.ExecContext(ctx, "INSERT INTO query_history(id,user_id,connection_id,sql,normalized_sql,query_hash,status,rows_returned,duration_ms,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)", item.ID, item.UserID, item.ConnectionID, item.SQL, item.NormalizedSQL, item.QueryHash, item.Status, item.RowsReturned, item.DurationMS, item.CreatedAt)
	return mapError(err)
}

func (s *Store) ListQueryHistory(ctx context.Context, userID, connectionID string, from, to *string) ([]domain.QueryHistory, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id,user_id,connection_id,sql,COALESCE(normalized_sql,''),COALESCE(query_hash,''),COALESCE(status,''),COALESCE(rows_returned,0),COALESCE(duration_ms,0),created_at
		FROM query_history WHERE user_id=?1 AND (?2 = '' OR connection_id=?2)
		AND (?3 IS NULL OR created_at>=?3) AND (?4 IS NULL OR created_at<=?4)
		ORDER BY created_at DESC LIMIT 200`, userID, connectionID, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]domain.QueryHistory, 0)
	for rows.Next() {
		var item domain.QueryHistory
		if err := rows.Scan(&item.ID, &item.UserID, &item.ConnectionID, &item.SQL, &item.NormalizedSQL, &item.QueryHash, &item.Status, &item.RowsReturned, &item.DurationMS, &item.CreatedAt); err != nil {
			return nil, err
		}
		result = append(result, item)
	}
	return result, rows.Err()
}

func nullString(value sql.NullString) *string {
	if !value.Valid {
		return nil
	}
	result := value.String
	return &result
}

package store

import (
	"context"
	"database/sql"
)

// SchemaSnapshot is the last successfully loaded object catalog for one
// database. It survives app and browser restarts until an explicit refresh,
// a connection edit, or DDL run through Rowset invalidates it.
func (s *Store) SchemaSnapshot(ctx context.Context, connectionID, database string) ([]byte, error) {
	var payload []byte
	err := s.db.QueryRowContext(ctx, "SELECT payload FROM schema_snapshots WHERE connection_id=? AND database_name=?", connectionID, database).Scan(&payload)
	if err == sql.ErrNoRows {
		return nil, ErrNotFound
	}
	return payload, mapError(err)
}

func (s *Store) PutSchemaSnapshot(ctx context.Context, connectionID, database string, payload []byte) error {
	_, err := s.db.ExecContext(ctx, `INSERT INTO schema_snapshots(connection_id,database_name,payload,updated_at)
		VALUES(?,?,?,datetime('now'))
		ON CONFLICT(connection_id,database_name) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at`, connectionID, database, payload)
	return mapError(err)
}

func (s *Store) DeleteSchemaSnapshots(ctx context.Context, connectionID string) error {
	_, err := s.db.ExecContext(ctx, "DELETE FROM schema_snapshots WHERE connection_id=?", connectionID)
	return mapError(err)
}

package store

import (
	"context"
	"database/sql"
	"errors"
)

var ErrWorkspaceConflict = errors.New("workspace revision conflict")

type Workspace struct {
	Revision          int64
	Ciphertext, Nonce []byte
}

func (s *Store) Workspace(ctx context.Context, userID string) (Workspace, error) {
	var item Workspace
	err := s.db.QueryRowContext(ctx, `SELECT revision, ciphertext, nonce FROM workspaces WHERE user_id = ?`, userID).Scan(&item.Revision, &item.Ciphertext, &item.Nonce)
	if errors.Is(err, sql.ErrNoRows) {
		return item, ErrNotFound
	}
	return item, err
}

// Compare-and-swap in one SQLite statement: a stale window cannot overwrite a
// newer workspace, including two clients racing to create the initial version.
func (s *Store) SaveWorkspace(ctx context.Context, userID string, expected int64, ciphertext, nonce []byte) error {
	var result sql.Result
	var err error
	if expected == 0 {
		result, err = s.db.ExecContext(ctx, `INSERT INTO workspaces(user_id, revision, ciphertext, nonce) VALUES (?, 1, ?, ?) ON CONFLICT(user_id) DO NOTHING`, userID, ciphertext, nonce)
	} else {
		result, err = s.db.ExecContext(ctx, `UPDATE workspaces SET revision = revision + 1, ciphertext = ?, nonce = ? WHERE user_id = ? AND revision = ?`, ciphertext, nonce, userID, expected)
	}
	if err != nil {
		return err
	}
	count, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if count != 1 {
		return ErrWorkspaceConflict
	}
	return nil
}

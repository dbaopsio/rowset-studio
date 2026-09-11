package store

import (
	"context"
	"database/sql"
	"errors"
)

var ErrNotebookConflict = errors.New("notebook revision conflict")

// Notebook is an encrypted notebook document owned by one user.
type Notebook struct {
	ID, OrgID, UserID    string
	Revision             int64
	Ciphertext, Nonce    []byte
	CreatedAt, UpdatedAt string
}

const notebookColumns = "id, org_id, user_id, revision, ciphertext, nonce, created_at, updated_at"

func scanNotebook(scanner interface{ Scan(...any) error }) (Notebook, error) {
	var item Notebook
	err := scanner.Scan(&item.ID, &item.OrgID, &item.UserID, &item.Revision, &item.Ciphertext, &item.Nonce, &item.CreatedAt, &item.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return item, ErrNotFound
	}
	return item, err
}

func (s *Store) ListNotebooks(ctx context.Context, userID string) ([]Notebook, error) {
	rows, err := s.db.QueryContext(ctx, "SELECT "+notebookColumns+" FROM notebooks WHERE user_id = ? ORDER BY updated_at DESC, id", userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]Notebook, 0)
	for rows.Next() {
		item, err := scanNotebook(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, item)
	}
	return result, rows.Err()
}

func (s *Store) Notebook(ctx context.Context, id, userID string) (Notebook, error) {
	return scanNotebook(s.db.QueryRowContext(ctx, "SELECT "+notebookColumns+" FROM notebooks WHERE id = ? AND user_id = ?", id, userID))
}

func (s *Store) CreateNotebook(ctx context.Context, item Notebook) error {
	_, err := s.db.ExecContext(ctx, "INSERT INTO notebooks("+notebookColumns+") VALUES (?, ?, ?, 1, ?, ?, ?, ?)", item.ID, item.OrgID, item.UserID, item.Ciphertext, item.Nonce, item.CreatedAt, item.UpdatedAt)
	return mapError(err)
}

// SaveNotebook replaces the content only if the stored revision still equals
// expected, so a stale editor can never overwrite newer content.
func (s *Store) SaveNotebook(ctx context.Context, id, userID string, expected int64, ciphertext, nonce []byte, updatedAt string) error {
	result, err := s.db.ExecContext(ctx, "UPDATE notebooks SET revision = revision + 1, ciphertext = ?, nonce = ?, updated_at = ? WHERE id = ? AND user_id = ? AND revision = ?", ciphertext, nonce, updatedAt, id, userID, expected)
	if err != nil {
		return err
	}
	count, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if count != 1 {
		return ErrNotebookConflict
	}
	return nil
}

func (s *Store) DeleteNotebook(ctx context.Context, id, userID string) error {
	result, err := s.db.ExecContext(ctx, "DELETE FROM notebooks WHERE id = ? AND user_id = ?", id, userID)
	if err != nil {
		return err
	}
	return requireChanged(result)
}

func (s *Store) SavedQueriesImported(ctx context.Context, userID string) (bool, error) {
	var marker int
	err := s.db.QueryRowContext(ctx, "SELECT 1 FROM notebook_imports WHERE user_id = ?", userID).Scan(&marker)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}

// CreateNotebookOnce records the one-time saved-query import and creates its
// notebook atomically; concurrent callers create at most one notebook.
func (s *Store) CreateNotebookOnce(ctx context.Context, item Notebook) (bool, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return false, err
	}
	defer tx.Rollback()
	result, err := tx.ExecContext(ctx, "INSERT INTO notebook_imports(user_id, imported_at) VALUES (?, ?) ON CONFLICT(user_id) DO NOTHING", item.UserID, item.CreatedAt)
	if err != nil {
		return false, err
	}
	if count, err := result.RowsAffected(); err != nil || count != 1 {
		return false, err
	}
	if _, err := tx.ExecContext(ctx, "INSERT INTO notebooks("+notebookColumns+") VALUES (?, ?, ?, 1, ?, ?, ?, ?)", item.ID, item.OrgID, item.UserID, item.Ciphertext, item.Nonce, item.CreatedAt, item.UpdatedAt); err != nil {
		return false, mapError(err)
	}
	return true, tx.Commit()
}

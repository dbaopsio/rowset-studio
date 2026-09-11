package store

import (
	"context"
	"database/sql"
	"errors"
)

// recordedMode lets other files report a mode recorded by earlier releases.
var recordedMode func(context.Context, *sql.Tx) (string, error)

// ClaimMode records whether the control database belongs to a shared
// installation. A shared database is never reopened as a personal workspace;
// databases that already hold users but carry no marker count as shared.
func (s *Store) ClaimMode(ctx context.Context, shared bool) error {
	mode := "personal"
	if shared {
		mode = "shared"
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS installation_mode (id INTEGER PRIMARY KEY CHECK(id=1), mode TEXT NOT NULL)`); err != nil {
		return err
	}
	var current string
	err = tx.QueryRowContext(ctx, `SELECT mode FROM installation_mode WHERE id=1`).Scan(&current)
	if errors.Is(err, sql.ErrNoRows) {
		if recordedMode != nil {
			if current, err = recordedMode(ctx, tx); err != nil {
				return err
			}
		}
		if current == "" {
			var count int
			if err = tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM users`).Scan(&count); err != nil {
				return err
			}
			if count > 0 {
				current = "shared"
			}
		}
	} else if err != nil {
		return err
	}
	if current == "shared" && !shared {
		return errors.New("this control database belongs to a shared installation; use a new database for a personal workspace")
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO installation_mode(id,mode) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET mode=excluded.mode`, mode); err != nil {
		return err
	}
	return tx.Commit()
}

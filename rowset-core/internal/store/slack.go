package store

import (
	"context"
	"database/sql"
	"errors"
)

// SlackSettings is where a user wants notifications posted. The webhook
// address arrives encrypted, as connection passwords do.
type SlackSettings struct {
	UserID            string
	Ciphertext, Nonce []byte
	// ScheduleRuns is all, failures or off.
	ScheduleRuns     string
	LongQuerySeconds int64
	UpdatedAt        string
}

func (s *Store) SaveSlackSettings(ctx context.Context, item SlackSettings) error {
	_, err := s.db.ExecContext(ctx, `INSERT INTO slack_settings(user_id, ciphertext, nonce, schedule_runs, long_query_seconds, updated_at)
		VALUES(?, ?, ?, ?, ?, ?)
		ON CONFLICT(user_id) DO UPDATE SET ciphertext=excluded.ciphertext, nonce=excluded.nonce, schedule_runs=excluded.schedule_runs, long_query_seconds=excluded.long_query_seconds, updated_at=excluded.updated_at`,
		item.UserID, item.Ciphertext, item.Nonce, item.ScheduleRuns, item.LongQuerySeconds, item.UpdatedAt)
	return mapError(err)
}

func (s *Store) SlackSettings(ctx context.Context, userID string) (SlackSettings, error) {
	item := SlackSettings{UserID: userID}
	err := s.db.QueryRowContext(ctx, "SELECT ciphertext, nonce, schedule_runs, long_query_seconds, updated_at FROM slack_settings WHERE user_id = ?", userID).
		Scan(&item.Ciphertext, &item.Nonce, &item.ScheduleRuns, &item.LongQuerySeconds, &item.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return item, ErrNotFound
	}
	return item, err
}

func (s *Store) DeleteSlackSettings(ctx context.Context, userID string) error {
	_, err := s.db.ExecContext(ctx, "DELETE FROM slack_settings WHERE user_id = ?", userID)
	return err
}

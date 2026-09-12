package store

import (
	"context"
	"database/sql"
	"errors"
)

// AISettings is how one user reaches an assistant. Key material is encrypted
// before it gets here, as for connection passwords.
type AISettings struct {
	UserID, Provider, Model string
	Ciphertext, Nonce       []byte
	ShareSchema             bool
	UpdatedAt               string
}

func (s *Store) SaveAISettings(ctx context.Context, item AISettings) error {
	_, err := s.db.ExecContext(ctx, `INSERT INTO ai_settings(user_id, provider, model, ciphertext, nonce, share_schema, updated_at)
		VALUES(?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(user_id) DO UPDATE SET provider=excluded.provider, model=excluded.model, ciphertext=excluded.ciphertext, nonce=excluded.nonce, share_schema=excluded.share_schema, updated_at=excluded.updated_at`,
		item.UserID, item.Provider, item.Model, item.Ciphertext, item.Nonce, item.ShareSchema, item.UpdatedAt)
	return mapError(err)
}

// AISettings returns the user's settings, or ErrNotFound when none are saved.
func (s *Store) AISettings(ctx context.Context, userID string) (AISettings, error) {
	item := AISettings{UserID: userID}
	err := s.db.QueryRowContext(ctx, "SELECT provider, model, ciphertext, nonce, share_schema, updated_at FROM ai_settings WHERE user_id = ?", userID).
		Scan(&item.Provider, &item.Model, &item.Ciphertext, &item.Nonce, &item.ShareSchema, &item.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return item, ErrNotFound
	}
	return item, err
}

func (s *Store) DeleteAISettings(ctx context.Context, userID string) error {
	_, err := s.db.ExecContext(ctx, "DELETE FROM ai_settings WHERE user_id = ?", userID)
	return err
}

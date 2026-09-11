package store

import (
	"context"
	"database/sql"
)

func (s *Store) CreateRefreshToken(ctx context.Context, id, userID, tokenHash, expiresAt string, sessionVersion int64) error {
	_, err := s.db.ExecContext(ctx, "INSERT INTO refresh_tokens(id,user_id,token_hash,expires_at,session_version) VALUES(?,?,?,?,?)", id, userID, tokenHash, expiresAt, sessionVersion)
	return mapError(err)
}

func (s *Store) ConsumeRefreshToken(ctx context.Context, tokenHash string) (string, int64, error) {
	var userID string
	var sessionVersion int64
	err := s.db.QueryRowContext(ctx, "UPDATE refresh_tokens SET revoked=1 WHERE token_hash=? AND revoked=0 AND expires_at>datetime('now') RETURNING user_id,session_version", tokenHash).Scan(&userID, &sessionVersion)
	if err != nil {
		return "", 0, mapError(err)
	}
	return userID, sessionVersion, nil
}

func (s *Store) RevokeRefreshTokensForUser(ctx context.Context, userID string) error {
	_, err := s.db.ExecContext(ctx, "UPDATE refresh_tokens SET revoked=1 WHERE user_id=? AND revoked=0", userID)
	return err
}

func (s *Store) UserSessionVersion(ctx context.Context, userID string) (int64, error) {
	var version int64
	err := s.db.QueryRowContext(ctx, "SELECT version FROM user_session_versions WHERE user_id=?", userID).Scan(&version)
	if err == sql.ErrNoRows {
		return 0, nil
	}
	return version, err
}

func (s *Store) BumpUserSessionVersion(ctx context.Context, userID string) error {
	_, err := s.db.ExecContext(ctx, "INSERT INTO user_session_versions(user_id,version) VALUES(?,1) ON CONFLICT(user_id) DO UPDATE SET version=version+1", userID)
	return err
}

func (s *Store) RecordLoginFailure(ctx context.Context, email, now string, lockoutSeconds int64) error {
	_, err := s.db.ExecContext(ctx, `INSERT INTO login_failures(email,fail_count,last_failed_at) VALUES(?,1,?)
		ON CONFLICT(email) DO UPDATE SET fail_count=CASE
		WHEN (julianday(excluded.last_failed_at)-julianday(login_failures.last_failed_at))*86400>=? THEN 1
		ELSE login_failures.fail_count+1 END,last_failed_at=excluded.last_failed_at`, email, now, lockoutSeconds)
	return err
}

func (s *Store) LoginFailureState(ctx context.Context, email string) (uint32, string, bool, error) {
	var count uint32
	var last string
	err := s.db.QueryRowContext(ctx, "SELECT fail_count,last_failed_at FROM login_failures WHERE email=?", email).Scan(&count, &last)
	if err == sql.ErrNoRows {
		return 0, "", false, nil
	}
	return count, last, err == nil, err
}

func (s *Store) ClearLoginFailures(ctx context.Context, email string) error {
	_, err := s.db.ExecContext(ctx, "DELETE FROM login_failures WHERE email=?", email)
	return err
}

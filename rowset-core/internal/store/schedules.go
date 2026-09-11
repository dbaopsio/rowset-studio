package store

import (
	"context"
	"database/sql"
	"errors"
)

// ScheduledQuery is a SELECT its owner runs on a schedule, writing each result
// to a file. The SQL is encrypted; Schedule holds the JSON schedule.
type ScheduledQuery struct {
	ID, OrgID, UserID, ConnectionID, Database, Name string
	Ciphertext, Nonce                               []byte
	Schedule, OutputDir, OutputFormat               string
	CatchUp, Enabled                                bool
	NextRunAt                                       *string
	CreatedAt, UpdatedAt                            string
}

// ScheduledRun records one run of a scheduled query.
type ScheduledRun struct {
	ID, QueryID, Trigger, StartedAt string
	FinishedAt                      *string
	Status                          string
	Rows                            int64
	OutputPath, Error               *string
}

const scheduledColumns = "id, org_id, user_id, connection_id, database_name, name, ciphertext, nonce, schedule, output_dir, output_format, catch_up, enabled, next_run_at, created_at, updated_at"
const scheduledRunColumns = "id, query_id, trigger, started_at, finished_at, status, row_count, output_path, error"

func scanScheduled(scanner interface{ Scan(...any) error }) (ScheduledQuery, error) {
	var item ScheduledQuery
	var next sql.NullString
	err := scanner.Scan(&item.ID, &item.OrgID, &item.UserID, &item.ConnectionID, &item.Database, &item.Name, &item.Ciphertext, &item.Nonce, &item.Schedule, &item.OutputDir, &item.OutputFormat, &item.CatchUp, &item.Enabled, &next, &item.CreatedAt, &item.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return item, ErrNotFound
	}
	if next.Valid {
		item.NextRunAt = &next.String
	}
	return item, err
}

func scanScheduledRun(scanner interface{ Scan(...any) error }) (ScheduledRun, error) {
	var run ScheduledRun
	var finished, path, message sql.NullString
	err := scanner.Scan(&run.ID, &run.QueryID, &run.Trigger, &run.StartedAt, &finished, &run.Status, &run.Rows, &path, &message)
	run.FinishedAt, run.OutputPath, run.Error = nullString(finished), nullString(path), nullString(message)
	return run, err
}

func (s *Store) listScheduled(ctx context.Context, where string, args ...any) ([]ScheduledQuery, error) {
	rows, err := s.db.QueryContext(ctx, "SELECT "+scheduledColumns+" FROM scheduled_queries "+where, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []ScheduledQuery{}
	for rows.Next() {
		item, err := scanScheduled(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Store) ListScheduledQueries(ctx context.Context, userID string) ([]ScheduledQuery, error) {
	return s.listScheduled(ctx, "WHERE user_id = ? ORDER BY name, created_at", userID)
}

// DueScheduledQueries lists enabled queries whose next run is at or before now
// (an RFC 3339 UTC time).
func (s *Store) DueScheduledQueries(ctx context.Context, now string) ([]ScheduledQuery, error) {
	return s.listScheduled(ctx, "WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ? ORDER BY next_run_at", now)
}

func (s *Store) ScheduledQuery(ctx context.Context, id, userID string) (ScheduledQuery, error) {
	return scanScheduled(s.db.QueryRowContext(ctx, "SELECT "+scheduledColumns+" FROM scheduled_queries WHERE id = ? AND user_id = ?", id, userID))
}

func (s *Store) CreateScheduledQuery(ctx context.Context, item ScheduledQuery) error {
	_, err := s.db.ExecContext(ctx, "INSERT INTO scheduled_queries("+scheduledColumns+") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", item.ID, item.OrgID, item.UserID, item.ConnectionID, item.Database, item.Name, item.Ciphertext, item.Nonce, item.Schedule, item.OutputDir, item.OutputFormat, item.CatchUp, item.Enabled, item.NextRunAt, item.CreatedAt, item.UpdatedAt)
	return mapError(err)
}

func (s *Store) UpdateScheduledQuery(ctx context.Context, item ScheduledQuery) error {
	result, err := s.db.ExecContext(ctx, "UPDATE scheduled_queries SET connection_id = ?, database_name = ?, name = ?, ciphertext = ?, nonce = ?, schedule = ?, output_dir = ?, output_format = ?, catch_up = ?, enabled = ?, next_run_at = ?, updated_at = ? WHERE id = ? AND user_id = ?", item.ConnectionID, item.Database, item.Name, item.Ciphertext, item.Nonce, item.Schedule, item.OutputDir, item.OutputFormat, item.CatchUp, item.Enabled, item.NextRunAt, item.UpdatedAt, item.ID, item.UserID)
	if err != nil {
		return mapError(err)
	}
	return requireChanged(result)
}

func (s *Store) SetScheduledNextRun(ctx context.Context, id string, next *string) error {
	_, err := s.db.ExecContext(ctx, "UPDATE scheduled_queries SET next_run_at = ? WHERE id = ?", next, id)
	return err
}

func (s *Store) DeleteScheduledQuery(ctx context.Context, id, userID string) error {
	result, err := s.db.ExecContext(ctx, "DELETE FROM scheduled_queries WHERE id = ? AND user_id = ?", id, userID)
	if err != nil {
		return err
	}
	return requireChanged(result)
}

// CreateScheduledRun records a started run and keeps the latest 100 per query.
func (s *Store) CreateScheduledRun(ctx context.Context, run ScheduledRun) error {
	if _, err := s.db.ExecContext(ctx, "INSERT INTO scheduled_query_runs("+scheduledRunColumns+") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", run.ID, run.QueryID, run.Trigger, run.StartedAt, run.FinishedAt, run.Status, run.Rows, run.OutputPath, run.Error); err != nil {
		return mapError(err)
	}
	_, err := s.db.ExecContext(ctx, "DELETE FROM scheduled_query_runs WHERE query_id = ?1 AND id NOT IN (SELECT id FROM scheduled_query_runs WHERE query_id = ?1 ORDER BY started_at DESC LIMIT 100)", run.QueryID)
	return err
}

func (s *Store) FinishScheduledRun(ctx context.Context, run ScheduledRun) error {
	_, err := s.db.ExecContext(ctx, "UPDATE scheduled_query_runs SET finished_at = ?, status = ?, row_count = ?, output_path = ?, error = ? WHERE id = ?", run.FinishedAt, run.Status, run.Rows, run.OutputPath, run.Error, run.ID)
	return err
}

func (s *Store) ListScheduledRuns(ctx context.Context, queryID string, limit int) ([]ScheduledRun, error) {
	rows, err := s.db.QueryContext(ctx, "SELECT "+scheduledRunColumns+" FROM scheduled_query_runs WHERE query_id = ? ORDER BY started_at DESC LIMIT ?", queryID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	runs := []ScheduledRun{}
	for rows.Next() {
		run, err := scanScheduledRun(rows)
		if err != nil {
			return nil, err
		}
		runs = append(runs, run)
	}
	return runs, rows.Err()
}

// LatestScheduledRuns returns the newest run of each of the user's queries.
func (s *Store) LatestScheduledRuns(ctx context.Context, userID string) (map[string]ScheduledRun, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT `+scheduledRunColumns+` FROM scheduled_query_runs r
		WHERE r.query_id IN (SELECT id FROM scheduled_queries WHERE user_id = ?)
		AND r.started_at = (SELECT MAX(started_at) FROM scheduled_query_runs WHERE query_id = r.query_id)`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	latest := map[string]ScheduledRun{}
	for rows.Next() {
		run, err := scanScheduledRun(rows)
		if err != nil {
			return nil, err
		}
		latest[run.QueryID] = run
	}
	return latest, rows.Err()
}

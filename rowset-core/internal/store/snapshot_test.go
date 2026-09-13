package store

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestSnapshotWritesAnOpenableCopy(t *testing.T) {
	ctx := context.Background()
	directory := t.TempDir()
	data, err := Open(ctx, filepath.Join(directory, "rowset-community.sqlite3"))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer data.Close()

	snapshots := filepath.Join(directory, "snapshots")
	path, err := data.Snapshot(ctx, snapshots, 7)
	if err != nil {
		t.Fatalf("snapshot: %v", err)
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("snapshot missing: %v", err)
	}

	// The copy is a database in its own right: it opens, and its migrations are
	// already applied, so the schema came across.
	copied, err := Open(ctx, path)
	if err != nil {
		t.Fatalf("open snapshot: %v", err)
	}
	defer copied.Close()
	var tables int
	if err := copied.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='connections'").Scan(&tables); err != nil {
		t.Fatalf("read snapshot: %v", err)
	}
	if tables != 1 {
		t.Fatalf("snapshot has no connections table")
	}

	// Taking another snapshot in the same second leaves the first one alone
	// rather than failing, because VACUUM INTO refuses to overwrite.
	again, err := data.Snapshot(ctx, snapshots, 7)
	if err != nil {
		t.Fatalf("second snapshot: %v", err)
	}
	if again == "" {
		t.Fatalf("second snapshot returned no path")
	}
}

func TestPruneSnapshotsKeepsTheNewest(t *testing.T) {
	directory := t.TempDir()
	for hour := 0; hour < 10; hour++ {
		name := fmt.Sprintf("rowset-20260912-%02d0000.sqlite3", hour)
		if err := os.WriteFile(filepath.Join(directory, name), []byte("x"), 0600); err != nil {
			t.Fatalf("write: %v", err)
		}
	}
	// Something else living in the directory is never touched.
	if err := os.WriteFile(filepath.Join(directory, "notes.txt"), []byte("x"), 0600); err != nil {
		t.Fatalf("write: %v", err)
	}
	if err := pruneSnapshots(directory, 7); err != nil {
		t.Fatalf("prune: %v", err)
	}
	entries, err := os.ReadDir(directory)
	if err != nil {
		t.Fatalf("read dir: %v", err)
	}
	var names []string
	for _, entry := range entries {
		names = append(names, entry.Name())
	}
	if len(names) != 8 {
		t.Fatalf("expected 7 snapshots and the unrelated file, got %v", names)
	}
	if _, err := os.Stat(filepath.Join(directory, "rowset-20260912-030000.sqlite3")); err != nil {
		t.Fatalf("newest snapshots not kept: %v", err)
	}
	if _, err := os.Stat(filepath.Join(directory, "rowset-20260912-020000.sqlite3")); !os.IsNotExist(err) {
		t.Fatalf("oldest snapshot not removed")
	}
	if _, err := os.Stat(filepath.Join(directory, "notes.txt")); err != nil {
		t.Fatalf("unrelated file removed: %v", err)
	}
}

func TestPruneSnapshotsKeepsEverythingWhenKeepIsZero(t *testing.T) {
	directory := t.TempDir()
	if err := os.WriteFile(filepath.Join(directory, "rowset-20260912-000000.sqlite3"), []byte("x"), 0600); err != nil {
		t.Fatalf("write: %v", err)
	}
	if err := pruneSnapshots(directory, 0); err != nil {
		t.Fatalf("prune: %v", err)
	}
	if _, err := os.Stat(filepath.Join(directory, "rowset-20260912-000000.sqlite3")); err != nil {
		t.Fatalf("snapshot removed with keep=0: %v", err)
	}
}

func TestDailySnapshotSkipsWhenARecentOneExists(t *testing.T) {
	ctx := context.Background()
	directory := t.TempDir()
	data, err := Open(ctx, filepath.Join(directory, "rowset-community.sqlite3"))
	if err != nil {
		t.Fatal(err)
	}
	defer data.Close()
	snapshots := filepath.Join(directory, "snapshots")
	if err := os.MkdirAll(snapshots, 0700); err != nil {
		t.Fatal(err)
	}
	old := "rowset-" + time.Now().UTC().Add(-26*time.Hour).Format("20060102-150405") + ".sqlite3"
	if err := os.WriteFile(filepath.Join(snapshots, old), []byte("x"), 0600); err != nil {
		t.Fatal(err)
	}
	first, err := data.DailySnapshot(ctx, snapshots, 7)
	if err != nil || first == "" {
		t.Fatalf("a day-old snapshot did not lead to a new one: %q %v", first, err)
	}
	// Restarting again the same day must not take another copy and rotate
	// out older ones.
	second, err := data.DailySnapshot(ctx, snapshots, 7)
	if err != nil || second != "" {
		t.Fatalf("a second snapshot was taken the same day: %q %v", second, err)
	}
}

func TestPendingMigrationsAreBackedUpBeforeTheyRun(t *testing.T) {
	ctx := context.Background()
	directory := t.TempDir()
	path := filepath.Join(directory, "rowset-community.sqlite3")
	backups := filepath.Join(directory, "snapshots")

	// A new database has nothing to lose, so nothing is copied.
	data, err := Open(ctx, path, WithMigrationBackup(backups))
	if err != nil {
		t.Fatal(err)
	}
	if entries, _ := os.ReadDir(backups); len(entries) != 0 {
		t.Fatalf("a new database was backed up: %d files", len(entries))
	}
	// Pretend this database predates one already-applied migration whose SQL is
	// safe to run again (028 creates indexes with IF NOT EXISTS), so reopening
	// treats it as pending and re-applies it after taking a backup.
	const latest int64 = 28
	if _, err := data.db.ExecContext(ctx, "DELETE FROM rowset_go_migrations WHERE version=?", latest); err != nil {
		t.Fatal(err)
	}
	data.Close()

	upgraded, err := Open(ctx, path, WithMigrationBackup(backups))
	if err != nil {
		t.Fatal(err)
	}
	defer upgraded.Close()
	entries, err := os.ReadDir(backups)
	if err != nil || len(entries) != 1 || !strings.HasPrefix(entries[0].Name(), "before-") {
		t.Fatalf("expected one pre-upgrade copy, got %v %v", entries, err)
	}
	// Read the copy as a plain file: opening it as a store would apply the
	// migration to it and hide what state it was taken in.
	raw, err := sql.Open("sqlite", "file:"+filepath.ToSlash(filepath.Join(backups, entries[0].Name()))+"?mode=ro")
	if err != nil {
		t.Fatal(err)
	}
	defer raw.Close()
	var inCopy, inLive int
	if err := raw.QueryRowContext(ctx, "SELECT COUNT(*) FROM rowset_go_migrations WHERE version=?", latest).Scan(&inCopy); err != nil {
		t.Fatal(err)
	}
	if err := upgraded.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM rowset_go_migrations WHERE version=?", latest).Scan(&inLive); err != nil {
		t.Fatal(err)
	}
	if inCopy != 0 || inLive != 1 {
		t.Fatalf("copy was not taken before the upgrade: migration %d in copy=%d, in live=%d", latest, inCopy, inLive)
	}
}

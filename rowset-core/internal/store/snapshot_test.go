package store

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"testing"
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

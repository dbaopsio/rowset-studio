package engine

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func countingLoader(t *testing.T, delay time.Duration, fail *atomic.Bool) *atomic.Int64 {
	t.Helper()
	var reads atomic.Int64
	original := loadSchema
	loadSchema = func(_ *Manager, ctx context.Context, connection Connection) (Schema, error) {
		reads.Add(1)
		select {
		case <-time.After(delay):
		case <-ctx.Done():
			return Schema{}, ctx.Err()
		}
		if fail != nil && fail.Load() {
			return Schema{}, errors.New("catalog unavailable")
		}
		return Schema{Tables: map[string][]Column{connection.Database + ".t": {{Name: "id"}}}}, nil
	}
	t.Cleanup(func() { loadSchema = original })
	return &reads
}

func TestSchemaLoadsOnceForConcurrentRequests(t *testing.T) {
	reads := countingLoader(t, 50*time.Millisecond, nil)
	manager := NewManager()
	connection := Connection{ID: "c1", Engine: "postgres", Database: "app"}
	var wg sync.WaitGroup
	for i := 0; i < 12; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			schema, err := manager.CachedSchema(context.Background(), connection, false)
			if err != nil || len(schema.Tables) != 1 {
				t.Errorf("schema=%v err=%v", schema, err)
			}
		}()
	}
	wg.Wait()
	if reads.Load() != 1 {
		t.Fatalf("catalog read %d times for concurrent requests", reads.Load())
	}
}

func TestSchemaIsReusedUntilRefreshedOrInvalidated(t *testing.T) {
	reads := countingLoader(t, 0, nil)
	manager := NewManager()
	app := Connection{ID: "c1", Engine: "postgres", Database: "app"}
	other := Connection{ID: "c2", Engine: "postgres", Database: "app"}
	ctx := context.Background()
	for _, step := range []struct {
		name       string
		run        func()
		wantReads  int64
		connection Connection
		refresh    bool
	}{
		{name: "first load", wantReads: 1, connection: app},
		{name: "cached", wantReads: 1, connection: app},
		{name: "refresh reads again", wantReads: 2, connection: app, refresh: true},
		{name: "another connection is separate", wantReads: 3, connection: other},
		{name: "invalidated after DDL", run: func() { manager.InvalidateSchema("c1") }, wantReads: 4, connection: app},
		{name: "invalidation left the other connection cached", wantReads: 4, connection: other},
	} {
		if step.run != nil {
			step.run()
		}
		if _, err := manager.CachedSchema(ctx, step.connection, step.refresh); err != nil {
			t.Fatalf("%s: %v", step.name, err)
		}
		if reads.Load() != step.wantReads {
			t.Fatalf("%s: reads=%d want %d", step.name, reads.Load(), step.wantReads)
		}
	}
}

func TestSchemaFailuresAreNotCached(t *testing.T) {
	var fail atomic.Bool
	fail.Store(true)
	reads := countingLoader(t, 0, &fail)
	manager := NewManager()
	connection := Connection{ID: "c1", Engine: "postgres", Database: "app"}
	if _, err := manager.CachedSchema(context.Background(), connection, false); err == nil {
		t.Fatal("expected the failing load to be reported")
	}
	fail.Store(false)
	if _, err := manager.CachedSchema(context.Background(), connection, false); err != nil {
		t.Fatalf("a failure was served from cache: %v", err)
	}
	if reads.Load() != 2 {
		t.Fatalf("reads=%d", reads.Load())
	}
}

func TestSchemaRefreshDoesNotReuseALoadAlreadyRunning(t *testing.T) {
	reads := countingLoader(t, 80*time.Millisecond, nil)
	manager := NewManager()
	connection := Connection{ID: "c1", Engine: "postgres", Database: "app"}
	go func() { _, _ = manager.CachedSchema(context.Background(), connection, false) }()
	time.Sleep(20 * time.Millisecond)
	// The running load may predate the object the person is refreshing for.
	if _, err := manager.CachedSchema(context.Background(), connection, true); err != nil {
		t.Fatal(err)
	}
	if reads.Load() != 2 {
		t.Fatalf("refresh joined the running load: reads=%d", reads.Load())
	}
}

func TestSchemaLoadSurvivesOneCallerLeaving(t *testing.T) {
	reads := countingLoader(t, 80*time.Millisecond, nil)
	manager := NewManager()
	connection := Connection{ID: "c1", Engine: "postgres", Database: "app"}
	leaving, leave := context.WithCancel(context.Background())
	started := make(chan struct{})
	go func() {
		close(started)
		_, _ = manager.CachedSchema(leaving, connection, false)
	}()
	<-started
	time.Sleep(10 * time.Millisecond)
	done := make(chan error, 1)
	go func() {
		_, err := manager.CachedSchema(context.Background(), connection, false)
		done <- err
	}()
	time.Sleep(10 * time.Millisecond)
	leave()
	if err := <-done; err != nil {
		t.Fatalf("the remaining caller lost its schema when another left: %v", err)
	}
	if reads.Load() != 1 {
		t.Fatalf("reads=%d", reads.Load())
	}
}

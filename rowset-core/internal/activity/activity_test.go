package activity

import (
	"context"
	"testing"
	"time"

	"github.com/dbaopsio/rowset-studio/rowset-core/internal/domain"
	"github.com/dbaopsio/rowset-studio/rowset-core/internal/store"
)

func TestBufferedFlushesOnClose(t *testing.T) {
	data, err := store.Open(context.Background(), t.TempDir()+"/rowset.sqlite3")
	if err != nil {
		t.Fatal(err)
	}
	defer data.Close()
	buffer := NewBuffered(SQLite{Data: data}, 4)
	item := domain.QueryHistory{ID: "history", UserID: "user", ConnectionID: "conn", SQL: "select 1", CreatedAt: time.Now().UTC().Format(time.RFC3339Nano)}
	if err := buffer.CreateQueryHistory(context.Background(), item); err != nil {
		t.Fatal(err)
	}
	buffer.Close()
	items, err := data.ListQueryHistory(context.Background(), "user", "conn", nil, nil)
	if err != nil || len(items) != 1 {
		t.Fatalf("items=%#v err=%v", items, err)
	}
}

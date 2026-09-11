package activity

import (
	"context"
	"errors"
	"log/slog"
	"sync"
	"time"

	"github.com/dbaopsio/rowset-studio/rowset-core/internal/domain"
	"github.com/dbaopsio/rowset-studio/rowset-core/internal/store"
)

type Store interface {
	Ping(context.Context) error
	WriteAudit(context.Context, domain.AuditLog) error
	CreateQueryHistory(context.Context, domain.QueryHistory) error
	ListQueryHistory(context.Context, string, string, *string, *string) ([]domain.QueryHistory, error)
	Purge(context.Context, *uint32, *uint32) (uint64, uint64, error)
}

type SQLite struct{ Data *store.Store }

func (s SQLite) Ping(ctx context.Context) error { return s.Data.Ping(ctx) }
func (s SQLite) WriteAudit(ctx context.Context, item domain.AuditLog) error {
	return s.Data.WriteAudit(ctx, item)
}
func (s SQLite) CreateQueryHistory(ctx context.Context, item domain.QueryHistory) error {
	return s.Data.CreateQueryHistory(ctx, item)
}
func (s SQLite) ListQueryHistory(ctx context.Context, userID, connectionID string, from, to *string) ([]domain.QueryHistory, error) {
	return s.Data.ListQueryHistory(ctx, userID, connectionID, from, to)
}
func (s SQLite) Purge(ctx context.Context, auditDays, historyDays *uint32) (uint64, uint64, error) {
	return s.Data.PurgeActivity(ctx, auditDays, historyDays)
}

type queuedRecord struct {
	audit   *domain.AuditLog
	history *domain.QueryHistory
}

type Buffered struct {
	backend Store
	queue   chan queuedRecord
	done    chan struct{}
	ctx     context.Context
	cancel  context.CancelFunc
	once    sync.Once
}

type batchStore interface {
	writeBatch(context.Context, []queuedRecord) error
}

func NewBuffered(backend Store, capacity int) *Buffered {
	if capacity < 1 {
		capacity = 1
	}
	ctx, cancel := context.WithCancel(context.Background())
	buffer := &Buffered{backend: backend, queue: make(chan queuedRecord, capacity), done: make(chan struct{}), ctx: ctx, cancel: cancel}
	go buffer.run()
	return buffer
}

func (b *Buffered) run() {
	defer close(b.done)
	for first := range b.queue {
		records := []queuedRecord{first}
		flushWindow := time.NewTimer(time.Millisecond)
	collect:
		for len(records) < 128 {
			select {
			case record, ok := <-b.queue:
				if !ok {
					break collect
				}
				records = append(records, record)
			case <-flushWindow.C:
				break collect
			}
		}
		if !flushWindow.Stop() {
			select {
			case <-flushWindow.C:
			default:
			}
		}
		delay := 100 * time.Millisecond
		for {
			ctx, cancel := context.WithTimeout(b.ctx, 30*time.Second)
			var err error
			if batch, ok := b.backend.(batchStore); ok {
				err = batch.writeBatch(ctx, records)
			} else {
				for _, record := range records {
					if record.audit != nil {
						err = b.backend.WriteAudit(ctx, *record.audit)
					} else if record.history != nil {
						err = b.backend.CreateQueryHistory(ctx, *record.history)
					}
					if err != nil {
						break
					}
				}
			}
			cancel()
			if err == nil {
				break
			}
			if b.ctx.Err() != nil {
				slog.Error("activity shutdown abandoned a batch after the graceful flush deadline", "error", err, "records", len(records))
				return
			}
			slog.Error("activity batch write failed; retrying without dropping records", "error", err, "records", len(records), "retry_ms", delay.Milliseconds())
			select {
			case <-time.After(delay):
			case <-b.ctx.Done():
				return
			}
			if delay < 10*time.Second {
				delay *= 2
				if delay > 10*time.Second {
					delay = 10 * time.Second
				}
			}
		}
	}
}

func (b *Buffered) Close() {
	b.once.Do(func() {
		close(b.queue)
		select {
		case <-b.done:
			b.cancel()
		case <-time.After(10 * time.Second):
			slog.Error("activity graceful flush deadline exceeded; cancelling the backend write")
			b.cancel()
			select {
			case <-b.done:
			case <-time.After(time.Second):
				slog.Error("activity writer did not stop after cancellation")
			}
		}
	})
}
func (b *Buffered) Ping(ctx context.Context) error { return b.backend.Ping(ctx) }
func (b *Buffered) WriteAudit(_ context.Context, item domain.AuditLog) error {
	select {
	case b.queue <- queuedRecord{audit: &item}:
		return nil
	default:
		err := errors.New("activity queue is full")
		slog.Error("activity audit record rejected", "error", err, "id", item.ID)
		return err
	}
}
func (b *Buffered) CreateQueryHistory(_ context.Context, item domain.QueryHistory) error {
	select {
	case b.queue <- queuedRecord{history: &item}:
		return nil
	default:
		err := errors.New("activity queue is full")
		slog.Error("activity query-history record rejected", "error", err, "id", item.ID)
		return err
	}
}
func (b *Buffered) ListQueryHistory(ctx context.Context, userID, connectionID string, from, to *string) ([]domain.QueryHistory, error) {
	return b.backend.ListQueryHistory(ctx, userID, connectionID, from, to)
}
func (b *Buffered) Purge(ctx context.Context, auditDays, historyDays *uint32) (uint64, uint64, error) {
	return b.backend.Purge(ctx, auditDays, historyDays)
}

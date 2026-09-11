package engine

import (
	"context"
	"fmt"
	"os"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestLiveOneThousandLogicalClientsUseBoundedPools(t *testing.T) {
	tests := []struct {
		name, passwordEnv, user, database, table string
		port                                     int
		setup                                    []string
	}{
		{"postgres", "ROWSET_MATRIX_POSTGRES_PASSWORD", "postgres", "rowset_e2e", "public.rowset_load_probe", 55432, []string{`DROP TABLE IF EXISTS public.rowset_load_probe`, `CREATE TABLE public.rowset_load_probe(id int primary key,value_text varchar(40))`}},
		{"mysql", "ROWSET_MATRIX_MYSQL_PASSWORD", "root", "rowset_e2e", "rowset_load_probe", 53306, []string{`DROP TABLE IF EXISTS rowset_load_probe`, `CREATE TABLE rowset_load_probe(id int primary key,value_text varchar(40))`}},
		{"mssql", "ROWSET_MATRIX_MSSQL_PASSWORD", "sa", "rowset_e2e", "dbo.rowset_load_probe", 51433, []string{`IF OBJECT_ID('dbo.rowset_load_probe','U') IS NOT NULL DROP TABLE dbo.rowset_load_probe`, `CREATE TABLE dbo.rowset_load_probe(id int primary key,value_text varchar(40))`}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			password := os.Getenv(test.passwordEnv)
			if password == "" {
				t.Skip(test.passwordEnv + " is not configured")
			}
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
			defer cancel()
			manager := NewManager()
			defer manager.Close()
			connection := Connection{ID: "load-" + test.name, Engine: test.name, Host: "127.0.0.1", Port: test.port, Database: test.database, Username: test.user, Password: password, PoolSize: 32}
			for _, statement := range test.setup {
				if _, err := manager.Execute(ctx, connection, statement, 0); err != nil {
					t.Fatal(err)
				}
			}
			values := ""
			for id := 1; id <= 20; id++ {
				if id > 1 {
					values += ","
				}
				values += fmt.Sprintf("(%d,'payload-%d')", id, id)
			}
			if _, err := manager.Execute(ctx, connection, "INSERT INTO "+test.table+"(id,value_text) VALUES "+values, 0); err != nil {
				t.Fatal(err)
			}

			const requests, concurrency = 1000, 32
			jobs := make(chan int, concurrency)
			errorsFound := make(chan error, requests)
			var rowsRead atomic.Int64
			var workers sync.WaitGroup
			started := time.Now()
			for worker := 0; worker < concurrency; worker++ {
				workers.Add(1)
				go func() {
					defer workers.Done()
					for job := range jobs {
						minimum := 1 + job%20
						query := fmt.Sprintf("SELECT id,value_text,UPPER(value_text) computed FROM %s WHERE id>=%d ORDER BY id", test.table, minimum)
						stream, err := manager.Query(ctx, connection, query)
						if err != nil {
							errorsFound <- err
							return
						}
						for {
							_, ok, err := stream.Next()
							if err != nil {
								_ = stream.Close()
								errorsFound <- err
								return
							}
							if !ok {
								break
							}
							rowsRead.Add(1)
						}
						if err := stream.Close(); err != nil {
							errorsFound <- err
							return
						}
					}
				}()
			}
			for request := 0; request < requests; request++ {
				jobs <- request
			}
			close(jobs)
			workers.Wait()
			close(errorsFound)
			for err := range errorsFound {
				t.Fatalf("load query failed: %v", err)
			}
			if rowsRead.Load() != 10500 {
				t.Fatalf("read %d rows, want 10500", rowsRead.Load())
			}
			duration := time.Since(started)
			t.Logf("1000 requests / %d rows / %d workers completed in %s (%.0f req/s)", rowsRead.Load(), concurrency, duration.Round(time.Millisecond), requests/duration.Seconds())
		})
	}
}

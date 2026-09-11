package engine

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"
)

// Real drivers decide whether a manual transaction survives an error; Studio
// relies on State() to never offer Commit for work the database discarded.
func TestLiveTransactionStateAfterErrorsCancelAndKill(t *testing.T) {
	tests := []struct {
		name, passwordEnv, user, table, sleep, backendID, kill string
		port                                                   int
		errorState                                             TransactionState
		setup                                                  []string
	}{
		{"postgres", "ROWSET_MATRIX_POSTGRES_PASSWORD", "postgres", "public.rowset_tx_recovery", "SELECT pg_sleep(5)", "SELECT pg_backend_pid()", "SELECT pg_terminate_backend(%v)", 55432, TransactionAborted, []string{`DROP TABLE IF EXISTS public.rowset_tx_recovery`, `CREATE TABLE public.rowset_tx_recovery(id int primary key)`}},
		{"mysql", "ROWSET_MATRIX_MYSQL_PASSWORD", "root", "rowset_tx_recovery", "SELECT SLEEP(5)", "SELECT CONNECTION_ID()", "KILL %v", 53306, TransactionActive, []string{`DROP TABLE IF EXISTS rowset_tx_recovery`, `CREATE TABLE rowset_tx_recovery(id int primary key)`}},
		{"mssql", "ROWSET_MATRIX_MSSQL_PASSWORD", "sa", "dbo.rowset_tx_recovery", "WAITFOR DELAY '00:00:05'", "SELECT @@SPID", "KILL %v", 51433, TransactionActive, []string{`IF OBJECT_ID('dbo.rowset_tx_recovery','U') IS NOT NULL DROP TABLE dbo.rowset_tx_recovery`, `CREATE TABLE dbo.rowset_tx_recovery(id int primary key)`}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			password := os.Getenv(test.passwordEnv)
			if password == "" {
				t.Skip(test.passwordEnv + " is not configured")
			}
			ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
			defer cancel()
			manager := NewManager()
			defer manager.Close()
			connection := Connection{ID: "recovery-" + test.name, Engine: test.name, Host: "127.0.0.1", Port: test.port, Database: "rowset_e2e", Username: test.user, Password: password, PoolSize: 4}
			for _, statement := range test.setup {
				if _, err := manager.Execute(ctx, connection, statement, 0); err != nil {
					t.Fatal(err)
				}
			}
			begin := func(id int) *Transaction {
				t.Helper()
				tx, err := manager.Begin(ctx, connection)
				if err != nil {
					t.Fatal(err)
				}
				if _, err := tx.Execute(ctx, fmt.Sprintf("INSERT INTO %s VALUES(%d)", test.table, id), 0); err != nil {
					t.Fatal(err)
				}
				if state := tx.State(); state != TransactionActive {
					t.Fatalf("fresh transaction state = %s", state)
				}
				return tx
			}
			committed := func() int64 {
				t.Helper()
				result, err := manager.Execute(ctx, connection, "SELECT COUNT(*) FROM "+test.table, 0)
				if err != nil {
					t.Fatal(err)
				}
				var count int64
				_, _ = fmt.Sscan(fmt.Sprint(result.Rows[0][0]), &count)
				return count
			}

			// A failed statement aborts the whole PostgreSQL transaction; MySQL and
			// SQL Server (XACT_ABORT off) keep it usable.
			tx := begin(1)
			if _, err := tx.Execute(ctx, "SELECT * FROM rowset_no_such_table", 0); err == nil {
				t.Fatal("missing table did not fail")
			}
			if state := tx.State(); state != test.errorState {
				t.Fatalf("state after statement error = %s, want %s", state, test.errorState)
			}
			_ = tx.Rollback()

			// Cancelling a statement closes the pinned connection in every driver.
			tx = begin(2)
			short, stop := context.WithTimeout(ctx, 300*time.Millisecond)
			_, err := tx.Execute(short, test.sleep, 0)
			stop()
			if err == nil {
				t.Fatal("sleep was not cancelled")
			}
			if state := tx.State(); state != TransactionLost {
				t.Fatalf("state after cancel = %s, want lost", state)
			}
			_ = tx.Rollback()

			// A server-side kill is detected once the next statement fails.
			tx = begin(3)
			backend, err := tx.Execute(ctx, test.backendID, 0)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := manager.Execute(ctx, connection, fmt.Sprintf(test.kill, backend.Rows[0][0]), 0); err != nil {
				t.Fatal(err)
			}
			time.Sleep(200 * time.Millisecond)
			if _, err := tx.Execute(ctx, "SELECT COUNT(*) FROM "+test.table, 0); err == nil {
				t.Fatal("statement on killed session succeeded")
			}
			if state := tx.State(); state != TransactionLost {
				t.Fatalf("state after kill = %s, want lost", state)
			}
			_ = tx.Rollback()

			if count := committed(); count != 0 {
				t.Fatalf("%d uncommitted rows survived failed transactions", count)
			}
		})
	}
}

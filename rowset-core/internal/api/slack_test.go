package api

import (
	"errors"
	"strings"
	"testing"
	"time"
)

func TestSlackMessagesSayWhatRanAndNeverTheRows(t *testing.T) {
	done := scheduledRunMessage("Daily sales", 1200, 95*time.Second, "/tmp/daily_sales.csv", nil)
	for _, want := range []string{"Daily sales", "1200 row(s)", "1m35s", "/tmp/daily_sales.csv"} {
		if !strings.Contains(done, want) {
			t.Errorf("message misses %q: %s", want, done)
		}
	}
	failed := scheduledRunMessage("Daily sales", 0, 2*time.Second, "", errors.New("connection refused"))
	if !strings.Contains(failed, "failed") || !strings.Contains(failed, "connection refused") {
		t.Errorf("failure message: %s", failed)
	}
	long := longStatementMessage("Docker PostgreSQL", "SELECT *\nFROM orders\nWHERE id > 0\nORDER BY id", 5, 3*time.Hour, "")
	if !strings.Contains(long, "3h0m0s") || !strings.Contains(long, "…") {
		t.Errorf("long statement message: %s", long)
	}
}

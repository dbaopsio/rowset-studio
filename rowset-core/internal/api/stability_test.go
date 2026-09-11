package api

import (
	"testing"
	"time"
)

func TestPersonalWorkspaceAllowsLongStatements(t *testing.T) {
	s, _ := personalServer(t)
	if got := s.defaultStatementTimeout(10 * time.Minute); got != 24*time.Hour {
		t.Fatalf("personal statement timeout = %s", got)
	}
	if got := s.transactionIdleTimeout(); got != time.Hour {
		t.Fatalf("personal transaction idle timeout = %s", got)
	}
	s.config.Shared = true
	if got := s.defaultStatementTimeout(10 * time.Minute); got != 10*time.Minute {
		t.Fatalf("shared statement timeout = %s", got)
	}
	if got := s.transactionIdleTimeout(); got != 5*time.Minute {
		t.Fatalf("shared transaction idle timeout = %s", got)
	}
}

func TestRunningTransactionIsNeverReaped(t *testing.T) {
	s, _ := personalServer(t)
	s.txnMu.Lock()
	s.txns["busy"] = &transactionEntry{lastUsed: time.Now().Add(-3 * time.Hour), running: 1}
	s.txnMu.Unlock()
	s.reapIdleTransactions()
	s.txnMu.Lock()
	kept := s.txns["busy"] != nil
	delete(s.txns, "busy") // it has no real database transaction to close
	s.txnMu.Unlock()
	if !kept {
		t.Fatal("a transaction with a statement still running was rolled back as idle")
	}
}

func TestPersonalOwnerIsNotRateLimited(t *testing.T) {
	s, _ := personalServer(t)
	s.config.RateLimitPerMinute = 1
	for range 5 {
		if !s.allowIdentity("owner") {
			t.Fatal("the personal owner was rate limited")
		}
	}
}

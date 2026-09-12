package api

import (
	"strings"
	"testing"
)

func TestAIPromptCarriesTheTaskStatementAndSchema(t *testing.T) {
	prompt := aiPrompt(aiAskInput{Task: "optimize", SQL: "SELECT * FROM orders", Plan: "Seq Scan"}, "TABLE public.orders\n  id integer PK\n  INDEX orders_pkey (id)\n")
	for _, want := range []string{"faster", "SELECT * FROM orders", "Seq Scan", "orders_pkey", "no data"} {
		if !strings.Contains(prompt, want) {
			t.Errorf("prompt misses %q:\n%s", want, prompt)
		}
	}
	fix := aiPrompt(aiAskInput{Task: "fix", SQL: "SELECT a, count(*) FROM t", Error: "column a must appear in the GROUP BY clause"}, "")
	if !strings.Contains(fix, "GROUP BY clause") || !strings.Contains(fix, "No schema was shared") {
		t.Errorf("fix prompt:\n%s", fix)
	}
}

func TestFirstSQLBlockTakesTheStatementToInsert(t *testing.T) {
	answer := "Here you go:\n\n```sql\nSELECT 1\nFROM dual\n```\n\nIt returns one row."
	if got := firstSQLBlock(answer); got != "SELECT 1\nFROM dual" {
		t.Fatalf("got %q", got)
	}
	if got := firstSQLBlock("No statement needed."); got != "" {
		t.Fatalf("got %q", got)
	}
}

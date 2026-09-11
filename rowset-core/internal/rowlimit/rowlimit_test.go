package rowlimit

import (
	"testing"

	sqlguard "github.com/dbaopsio/rowset-studio/rowset-parser"
)

func apply(t *testing.T, engine, sql string, limit int) string {
	t.Helper()
	info, err := sqlguard.Parse(sql)
	if err != nil {
		t.Fatalf("%s: %v", sql, err)
	}
	out, err := Apply(engine, info, limit)
	if err != nil {
		t.Fatalf("%s: %v", sql, err)
	}
	return out
}

func TestApplyCapsEveryShapeOfSelect(t *testing.T) {
	tests := []struct{ engine, sql, want string }{
		{"postgres", "SELECT * FROM t WHERE id > 0", "SELECT * FROM t WHERE id > 0 LIMIT 10"},
		{"postgres", "SELECT * FROM t ORDER BY id", "SELECT * FROM t ORDER BY id LIMIT 10"},
		{"postgres", "SELECT * FROM t LIMIT 5", "SELECT * FROM t LIMIT 5"},
		{"postgres", "SELECT * FROM t LIMIT 500 OFFSET 20", "SELECT * FROM t LIMIT 10 OFFSET 20"},
		{"postgres", "SELECT * FROM t FETCH FIRST 100 ROWS ONLY", "SELECT * FROM t FETCH FIRST 10 ROWS ONLY"},
		{"postgres", "SELECT * FROM t WHERE id > 0 FOR UPDATE", "SELECT * FROM t WHERE id > 0 LIMIT 10 FOR UPDATE"},
		{"postgres", "SELECT a FROM t UNION SELECT b FROM u", "SELECT a FROM t UNION SELECT b FROM u LIMIT 10"},
		{"mysql", "SELECT * FROM t LIMIT 100, 500", "SELECT * FROM t LIMIT 100, 10"},
		{"mysql", "SELECT * FROM t WHERE id > 0 LOCK IN SHARE MODE", "SELECT * FROM t WHERE id > 0 LIMIT 10 LOCK IN SHARE MODE"},
		{"mssql", "SELECT * FROM t WHERE id > 0", "SELECT TOP (10) * FROM t WHERE id > 0"},
		{"mssql", "SELECT DISTINCT name FROM t", "SELECT DISTINCT TOP (10) name FROM t"},
		{"mssql", "SELECT TOP (5) * FROM t", "SELECT TOP (5) * FROM t"},
		{"mssql", "WITH x AS (SELECT id FROM t WHERE id > 0) SELECT * FROM x", "WITH x AS (SELECT id FROM t WHERE id > 0) SELECT TOP (10) * FROM x"},
		{"mssql", "SELECT NEXT VALUE FOR seq", "SELECT NEXT VALUE FOR seq"},
		{"mssql", "SELECT * FROM t ORDER BY id OFFSET 20 ROWS FETCH NEXT 500 ROWS ONLY", "SELECT * FROM t ORDER BY id OFFSET 20 ROWS FETCH NEXT 10 ROWS ONLY"},
	}
	for _, test := range tests {
		if got := apply(t, test.engine, test.sql, 10); got != test.want {
			t.Errorf("%s %s\n got %s\nwant %s", test.engine, test.sql, got, test.want)
		}
	}
	if got := apply(t, "postgres", "UPDATE t SET a = 1 WHERE id = 2", 10); got != "UPDATE t SET a = 1 WHERE id = 2" {
		t.Errorf("writes must not be rewritten: %s", got)
	}
}

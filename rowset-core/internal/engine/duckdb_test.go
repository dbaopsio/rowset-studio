//go:build cgo

package engine

import (
	"context"
	"path/filepath"
	"strings"
	"testing"
)

func TestDuckDBQuerySchemaDDLAndPrecision(t *testing.T) {
	path := filepath.Join(t.TempDir(), "analytics.duckdb")
	db, err := openDuckDB(path)
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(`CREATE TABLE items(id BIGINT, amount DECIMAL(38,6), name VARCHAR); INSERT INTO items VALUES (9007199254740993,12345678901234567890.123456,'hello'); CREATE VIEW names AS SELECT name FROM items`)
	db.Close()
	if err != nil {
		t.Fatal(err)
	}
	m := NewManager()
	defer m.Close()
	c := Connection{ID: "duckdb", Engine: "duckdb", Database: path}
	ctx := context.Background()
	if err = m.Test(ctx, c); err != nil {
		t.Fatal(err)
	}
	schema, err := m.Schema(ctx, c)
	if err != nil {
		t.Fatal(err)
	}
	if len(schema.Tables["main.items"]) != 3 || !schema.Views["main.names"] {
		t.Fatalf("schema: %#v", schema)
	}
	ddl, err := m.ObjectDDL(ctx, c, "table", "main", "items")
	if err != nil || !strings.Contains(ddl, "DECIMAL(38,6)") && !strings.Contains(ddl, "DECIMAL(38, 6)") {
		t.Fatalf("ddl: %s %v", ddl, err)
	}
	r, err := m.Execute(ctx, c, "SELECT id,amount,name FROM items", 10)
	if err != nil {
		t.Fatal(err)
	}
	if r.Rows[0][0] != int64(9007199254740993) || r.Rows[0][1] != "12345678901234567890.123456" {
		t.Fatalf("precision: %#v", r.Rows)
	}
}

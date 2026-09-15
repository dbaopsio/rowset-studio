//go:build cgo

package engine

import (
	"database/sql"
	_ "github.com/duckdb/duckdb-go/v2"
)

const DuckDBAvailable = true

func openDuckDB(path string) (*sql.DB, error) { return sql.Open("duckdb", path) }

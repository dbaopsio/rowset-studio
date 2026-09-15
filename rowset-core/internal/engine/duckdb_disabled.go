//go:build !cgo

package engine

import (
	"database/sql"
	"errors"
)

const DuckDBAvailable = false

func openDuckDB(string) (*sql.DB, error) {
	return nil, errors.New("this build does not include DuckDB; build Rowset with CGO_ENABLED=1")
}

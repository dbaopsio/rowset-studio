package api

import (
	"bufio"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

type exportInput struct {
	Database string `json:"database"`
	Schema   string `json:"schema"`
	Table    string `json:"table"`
	// SQL exports the whole result of one SELECT instead of a table.
	SQL    string `json:"sql"`
	Format string `json:"format"`
}

// exportTable downloads a whole table as CSV or JSON. It runs SELECT * with
// the checks of the editor, so policies, row limits and result hooks apply.
// The file is written to a temporary file first, so a failure part way is
// reported as an error instead of a truncated download.
func (s *Server) exportTable(w http.ResponseWriter, r *http.Request) {
	defer s.holdAwake()()
	connection, ok := s.authorizedConnection(w, r)
	if !ok {
		return
	}
	var input exportInput
	if !decodeJSON(w, r, &input) {
		return
	}
	input.Table, input.Schema, input.Database, input.SQL = strings.TrimSpace(input.Table), strings.TrimSpace(input.Schema), strings.TrimSpace(input.Database), strings.TrimSpace(input.SQL)
	if (input.Table == "" && input.SQL == "") || (input.Format != "csv" && input.Format != "json") {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "a table or a SELECT, and a csv or json format, are required")
		return
	}
	identity := identityFromContext(r.Context())
	role, err := s.store.UserRole(r.Context(), identity.UserID)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "role missing")
		return
	}
	sql, name := input.SQL, "query-result"
	if sql == "" {
		sql, name = "SELECT * FROM "+qualifiedTable(connection.Engine, input.Schema, input.Table), fileSlug(input.Table)
	}
	selected, err := s.openGovernedSelect(r.Context(), r, identity, role, connection, input.Database, sql, "export", 30*time.Minute)
	if err != nil {
		if errors.Is(err, errSelectBlocked) {
			writeError(w, http.StatusForbidden, "POLICY_DENIED", strings.TrimPrefix(err.Error(), errSelectBlocked.Error()+": "))
			return
		}
		writeError(w, http.StatusBadGateway, "EXEC_ERROR", err.Error())
		return
	}
	defer selected.Close()
	file, err := os.CreateTemp("", "rowset-export-*")
	if err != nil {
		selected.finish(0, err)
		writeError(w, http.StatusInternalServerError, "INTERNAL", "the export file could not be created")
		return
	}
	defer func() {
		_ = file.Close()
		_ = os.Remove(file.Name())
	}()
	buffered := bufio.NewWriter(file)
	rows, truncated, err := writeRows(buffered, input.Format, selected.stream, selected.transforms, selected.limit)
	if err == nil {
		err = buffered.Flush()
	}
	selected.finish(rows, err)
	if err != nil {
		writeError(w, http.StatusBadGateway, "EXEC_ERROR", err.Error())
		return
	}
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", "the export file could not be read")
		return
	}
	contentType := "text/csv; charset=utf-8"
	if input.Format == "json" {
		contentType = "application/json"
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s.%s"`, name, input.Format))
	w.Header().Set("X-Rowset-Rows", fmt.Sprint(rows))
	if truncated {
		w.Header().Set("X-Rowset-Truncated", "true")
	}
	_, _ = io.Copy(w, file)
}

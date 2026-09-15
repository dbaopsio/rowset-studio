package api

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/dbaopsio/rowset-studio/rowset-core/internal/engine"
)

// cassandraQuery runs a single read-only CQL statement. CQL is not SQL, so
// it does not go through the SQL guardrail parser/policy engine the other
// engines use; instead only SELECT is accepted, which is enforced here.
func (s *Server) cassandraQuery(w http.ResponseWriter, r *http.Request) {
	connection, ok := s.authorizedConnection(w, r)
	if !ok {
		return
	}
	identity := identityFromContext(r.Context())
	if connection.Engine != "cassandra" || s.config.Shared || !identity.IsAdmin() {
		writeError(w, 403, "UNSUPPORTED", "CQL queries are available to personal workspace administrators only")
		return
	}
	var input engine.CassandraQueryInput
	if !decodeJSON(w, r, &input) {
		return
	}
	trimmed := strings.TrimSpace(input.Query)
	if !strings.HasPrefix(strings.ToUpper(trimmed), "SELECT") {
		writeError(w, 400, "BAD_REQUEST", "only SELECT statements are supported")
		return
	}
	if input.Limit == 0 {
		input.Limit = 1000
	}
	if input.Limit < 1 || input.Limit > 10000 {
		writeError(w, 400, "BAD_REQUEST", "limit must be between 1 and 10000")
		return
	}
	database := input.Keyspace
	if database == "" {
		database = connection.Database
	}
	input.Keyspace = database
	_, _, _, timeout, err := s.resolvePolicies(r, identity, connection)
	if err != nil {
		writeError(w, 500, "INTERNAL", "policies unavailable")
		return
	}
	target, err := s.engineConnection(r, connection, database)
	if err != nil {
		writeError(w, 502, "EXEC_ERROR", err.Error())
		return
	}
	ctx, cancel := withConnectionTimeout(r, connection, timeout, 10*time.Minute)
	defer cancel()
	started := time.Now()
	result, err := s.engines.CassandraQuery(ctx, target, input)
	duration := time.Since(started).Milliseconds()
	raw, _ := json.Marshal(input)
	if err != nil {
		s.recordActivity(r, connection.ID, string(raw), "error", 0, duration, "", "", auditMeta{decision: "allow", errorMessage: err.Error()})
		writeError(w, 502, "EXEC_ERROR", err.Error())
		return
	}
	s.recordActivity(r, connection.ID, string(raw), "success", int64(len(result.Rows)), duration, "", "", auditMeta{decision: "allow"})
	writeJSON(w, 200, result)
}

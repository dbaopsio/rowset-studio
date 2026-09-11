package api

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/dbaopsio/rowset-studio/rowset-core/internal/domain"
)

func streamColumnTypes(stream queryRowStream) []string {
	if typed, ok := stream.(interface{ DatabaseTypes() []string }); ok {
		return typed.DatabaseTypes()
	}
	return []string{}
}

func (s *Server) streamNDJSON(w http.ResponseWriter, r *http.Request, connection domain.Connection, sql, normalized, hash, reference string, stream queryRowStream, transforms ResultTransforms, annotations Annotations, limited bool, limit int) {
	w.Header().Set("Content-Type", "application/x-ndjson")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Accel-Buffering", "no")
	encoder := json.NewEncoder(w)
	flush := func() {
		if f, ok := w.(http.Flusher); ok {
			f.Flush()
		}
	}
	writeErr := encoder.Encode(annotations.addTo(map[string]any{"type": "columns", "columns": stream.Columns(), "columnTypes": streamColumnTypes(stream)}))
	flush()
	var streamErr error
	count := int64(0)
	truncated := false
	batch := make([][]any, 0, 128)
	last := time.Now()
	for writeErr == nil {
		row, ok, err := stream.Next()
		if err != nil {
			streamErr = err
			break
		}
		if !ok {
			break
		}
		if limited && limit > 0 && count >= int64(limit) {
			truncated = true
			break
		}
		transforms.apply(row)
		batch = append(batch, browserRow(row))
		count++
		if len(batch) >= 128 || time.Since(last) > 100*time.Millisecond {
			writeErr = encoder.Encode(map[string]any{"type": "rows", "rows": batch})
			flush()
			batch = make([][]any, 0, 128)
			last = time.Now()
		}
	}
	if writeErr == nil && len(batch) > 0 {
		writeErr = encoder.Encode(map[string]any{"type": "rows", "rows": batch})
	}
	status, message := "success", ""
	if truncated {
		status = "truncated"
	}
	if streamErr != nil {
		status, message = "error", streamErr.Error()
	}
	if writeErr != nil {
		status, message = "error", writeErr.Error()
	}
	if writeErr == nil {
		tail := map[string]any{"type": "complete", "rowCount": count, "durationMs": stream.DurationMS(), "truncated": truncated}
		if truncated {
			tail["policyNotice"] = "Result limited by the fetch size or a query policy."
		}
		if streamErr != nil {
			tail["error"] = streamErr.Error()
		}
		if err := encoder.Encode(tail); err != nil {
			status, message = "error", err.Error()
		}
		flush()
	}
	s.recordActivity(r, connection.ID, sql, status, count, stream.DurationMS(), normalized, hash, auditMeta{decision: "allow", reference: reference, errorMessage: message})
}

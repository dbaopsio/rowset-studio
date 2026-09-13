package api

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"testing"
	"time"
)

// Progress has to reach the page while connections are still running, and a
// long run must not be cut off by the timeout ordinary API requests get: the
// request goes through the full middleware here, as it does in the app.
func TestMultiRunProgressStreamsThroughTheMiddleware(t *testing.T) {
	c := newE2EClient(t)
	if c.remote {
		t.Skip("runs against an in-process server")
	}
	original := runStatement
	runStatement = func(_ *Server, ctx context.Context, _ *http.Request, _ multiRunTarget, _ string, _ bool) statementOutcome {
		select {
		case <-time.After(400 * time.Millisecond):
		case <-ctx.Done():
			return statementOutcome{err: ctx.Err().Error()}
		}
		count := int64(1)
		return statementOutcome{body: json.RawMessage(`{"columns":["n"],"rows":[[1]],"rowCount":1}`), rowCount: &count, hasColumns: true}
	}
	t.Cleanup(func() { runStatement = original })

	body, _ := json.Marshal(map[string]any{"targets": []map[string]string{{"connectionId": "a"}, {"connectionId": "b"}}, "statements": []string{"SELECT 1"}, "concurrency": 1})
	request, _ := http.NewRequest(http.MethodPost, c.base+"/api/multirun", bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", "Bearer "+c.token)
	request.Header.Set("Accept-Encoding", "identity")
	started := time.Now()
	response, err := c.client.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	scanner := bufio.NewScanner(response.Body)
	if !scanner.Scan() {
		t.Fatalf("no progress at all: %v", scanner.Err())
	}
	first := time.Since(started)
	for scanner.Scan() {
	}
	total := time.Since(started)
	// Two connections one after the other take about 800ms; the first event
	// must arrive long before that.
	if first > 300*time.Millisecond || total < 700*time.Millisecond {
		t.Fatalf("first event after %s, whole run %s: progress was held back until the end", first, total)
	}
}

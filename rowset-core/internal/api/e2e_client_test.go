package api

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// e2eClient drives Rowset over its HTTP API, as Studio does. By default it
// starts a private in-process server. With ROWSET_E2E_DESKTOP_DIR set to a
// desktop data directory it signs in to that running instance instead, so
// the runs show up in its Activity and Row backups; it then uses the
// instance's existing connections and puts any policy it changes back.
type e2eClient struct {
	base, token string
	remote      bool
	client      *http.Client
}

func newE2EClient(t *testing.T) *e2eClient {
	t.Helper()
	if directory := os.Getenv("ROWSET_E2E_DESKTOP_DIR"); directory != "" {
		raw, err := os.ReadFile(filepath.Join(directory, "instance.json"))
		if err != nil {
			t.Fatalf("desktop instance: %v", err)
		}
		var state desktopInstance
		if err := json.Unmarshal(raw, &state); err != nil {
			t.Fatal(err)
		}
		c := &e2eClient{base: fmt.Sprintf("http://127.0.0.1:%d", state.Port), remote: true, client: &http.Client{Timeout: 30 * time.Minute}}
		code, _, body := c.send(t, "POST", "/api/local/open", nil, "Bearer "+state.Key)
		var ticket struct{ Ticket string }
		if code != http.StatusOK || json.Unmarshal(body, &ticket) != nil {
			t.Fatalf("local open: %d %s", code, body)
		}
		code, _, body = c.send(t, "POST", "/api/auth/local", map[string]string{"ticket": ticket.Ticket}, "")
		var session struct{ AccessToken string }
		if code != http.StatusOK || json.Unmarshal(body, &session) != nil {
			t.Fatalf("local sign-in: %d %s", code, body)
		}
		c.token = session.AccessToken
		return c
	}
	s, identity := personalServer(t)
	server := httptest.NewServer(s.Handler())
	t.Cleanup(server.Close)
	w := httptest.NewRecorder()
	s.issueSession(w, httptest.NewRequest("POST", "/api/auth/login", nil), identity, "unused", nil)
	var session struct{ AccessToken string }
	if err := json.Unmarshal(w.Body.Bytes(), &session); err != nil || session.AccessToken == "" {
		t.Fatalf("session: %s", w.Body.String())
	}
	return &e2eClient{base: server.URL, token: session.AccessToken, client: server.Client()}
}

type desktopInstance struct {
	Port int    `json:"port"`
	Key  string `json:"key"`
}

// send makes one request. body is JSON-encoded unless it is a string, which
// is sent as is.
func (c *e2eClient) send(t *testing.T, method, path string, body any, authorization string) (int, http.Header, []byte) {
	t.Helper()
	var reader io.Reader
	switch value := body.(type) {
	case nil:
	case string:
		reader = strings.NewReader(value)
	default:
		encoded, err := json.Marshal(value)
		if err != nil {
			t.Fatal(err)
		}
		reader = bytes.NewReader(encoded)
	}
	request, err := http.NewRequest(method, c.base+path, reader)
	if err != nil {
		t.Fatal(err)
	}
	if _, raw := body.(string); !raw && body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	if authorization != "" {
		request.Header.Set("Authorization", authorization)
	}
	response, err := c.client.Do(request)
	if err != nil {
		t.Fatalf("%s %s: %v", method, path, err)
	}
	defer response.Body.Close()
	data, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatalf("%s %s: %v", method, path, err)
	}
	return response.StatusCode, response.Header, data
}

func (c *e2eClient) do(t *testing.T, method, path string, body any) (int, http.Header, []byte) {
	t.Helper()
	return c.send(t, method, path, body, "Bearer "+c.token)
}

// stream runs a query the way Studio does, over NDJSON, and returns the
// number of rows and the completion event.
func (c *e2eClient) stream(t *testing.T, connectionID string, payload map[string]any) (int, int, map[string]any) {
	t.Helper()
	encoded, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	request, err := http.NewRequest("POST", c.base+"/api/connections/"+connectionID+"/query", strings.NewReader(string(encoded)))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/x-ndjson")
	request.Header.Set("Authorization", "Bearer "+c.token)
	response, err := c.client.Do(request)
	if err != nil {
		t.Fatalf("stream: %v", err)
	}
	defer response.Body.Close()
	rows, complete, biggest := 0, map[string]any{}, 0
	scanner := bufio.NewScanner(response.Body)
	scanner.Buffer(make([]byte, 0, 64<<10), 32<<20)
	for scanner.Scan() {
		if len(scanner.Bytes()) > biggest {
			biggest = len(scanner.Bytes())
		}
		var event map[string]any
		if err := json.Unmarshal(scanner.Bytes(), &event); err != nil {
			t.Fatalf("stream event: %v", err)
		}
		switch event["type"] {
		case "rows":
			rows += len(event["rows"].([]any))
		case "complete":
			complete = event
		}
	}
	if err := scanner.Err(); err != nil {
		t.Fatalf("stream body: %v", err)
	}
	if biggest > 16<<20 {
		t.Errorf("one NDJSON line was %d bytes, more than a browser will parse", biggest)
	}
	return response.StatusCode, rows, complete
}

// setPolicy turns a built-in policy on or off. On a desktop instance the
// previous setting is put back when the test ends.
func (c *e2eClient) setPolicy(t *testing.T, key string, enabled bool) {
	t.Helper()
	if c.remote {
		code, _, body := c.do(t, "GET", "/api/policies", nil)
		var list struct {
			Policies []struct {
				Key     string `json:"key"`
				Enabled bool   `json:"enabled"`
			} `json:"policies"`
		}
		if code != http.StatusOK || json.Unmarshal(body, &list) != nil {
			t.Fatalf("policies: %d %.300s", code, body)
		}
		for _, item := range list.Policies {
			if item.Key == key && item.Enabled != enabled {
				previous := item.Enabled
				t.Cleanup(func() { c.do(t, "PATCH", "/api/policies/"+key, map[string]bool{"enabled": previous}) })
			}
		}
	}
	if code, _, body := c.do(t, "PATCH", "/api/policies/"+key, map[string]bool{"enabled": enabled}); code >= 300 {
		t.Fatalf("policy %s: %d %s", key, code, body)
	}
}

// connection returns a connection to engine's test database: on a desktop
// instance the existing one for that engine, otherwise a new one.
func (c *e2eClient) connection(t *testing.T, engine importEngine, password string) string {
	t.Helper()
	normalize := func(name string) string {
		if name == "sqlserver" {
			return "mssql"
		}
		return name
	}
	if c.remote {
		code, _, body := c.do(t, "GET", "/api/connections", nil)
		var list struct {
			Connections []struct {
				ID, Name, Engine string
			} `json:"connections"`
		}
		if code != http.StatusOK || json.Unmarshal(body, &list) != nil {
			t.Fatalf("connections: %d %.300s", code, body)
		}
		for _, item := range list.Connections {
			if normalize(item.Engine) == normalize(engine.engine) && strings.Contains(strings.ToLower(item.Name), "docker") {
				return item.ID
			}
		}
		t.Skipf("the desktop instance has no Docker %s connection", engine.engine)
	}
	code, _, body := c.do(t, "POST", "/api/connections", map[string]any{"name": engine.engine, "engine": engine.engine, "host": "127.0.0.1", "port": engine.port, "database": "rowset_e2e", "connectionUsername": engine.user, "password": password, "tlsMode": "disable"})
	var created struct{ ID string }
	if code != http.StatusCreated || json.Unmarshal(body, &created) != nil {
		t.Fatalf("connection: %d %s", code, body)
	}
	return created.ID
}

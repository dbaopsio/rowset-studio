package api

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
)

func TestSQLiteConnectionThroughAPI(t *testing.T) {
	t.Setenv("ROWSET_E2E_DESKTOP_DIR", "")
	path := filepath.Join(t.TempDir(), "app.sqlite")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(`CREATE TABLE items(id INTEGER PRIMARY KEY, name TEXT); INSERT INTO items VALUES(1,'hello')`)
	db.Close()
	if err != nil {
		t.Fatal(err)
	}
	c := newRecordedAdditionalClient(t)
	code, _, body := c.do(t, "POST", "/api/connections", map[string]any{"name": "Local SQLite", "engine": "sqlite", "database": path, "tlsMode": "disable"})
	if code != 201 {
		t.Fatalf("create: %d %s", code, body)
	}
	var connection struct{ ID string }
	if err = json.Unmarshal(body, &connection); err != nil {
		t.Fatal(err)
	}
	for _, suffix := range []string{"/schema", "/databases", "/ddl?kind=table&schema=main&name=items"} {
		code, _, body = c.do(t, "GET", "/api/connections/"+connection.ID+suffix, nil)
		if code != 200 {
			t.Fatalf("%s: %d %s", suffix, code, body)
		}
	}
	code, _, body = c.do(t, "POST", "/api/connections/"+connection.ID+"/query", map[string]any{"sql": "SELECT id,name FROM items WHERE id=1"})
	if code != 200 || !strings.Contains(string(body), "hello") {
		t.Fatalf("query: %d %s", code, body)
	}
	code, _, body = c.do(t, "POST", "/api/connections/"+connection.ID+"/query", map[string]any{"sql": "SELECT 1", "database": filepath.Join(t.TempDir(), "different.sqlite")})
	if code == 200 {
		t.Fatalf("file override accepted: %s", body)
	}
}

func TestAdditionalConnectionsKeepEngineValidation(t *testing.T) {
	for _, kind := range []string{"clickhouse", "mongodb"} {
		input := connectionInput{Name: "new", Engine: kind, Host: "localhost", Port: 9000}
		c, _, message := normalizeConnectionInput(input, nil, "org")
		if message != "" || c.Engine != kind {
			t.Fatalf("%s: %s", kind, message)
		}
	}
	input := connectionInput{Name: "new", Engine: "mongodb", Host: "localhost", Port: 27017}
	host := "bastion"
	input.SSHHost = &host
	if _, _, message := normalizeConnectionInput(input, nil, "org"); message == "" {
		t.Fatal("Mongo SSH accepted")
	}
}

func TestConnectionNamesAreUniquePerOrgCaseAndWhitespaceInsensitive(t *testing.T) {
	touch := func(name string) string {
		path := filepath.Join(t.TempDir(), name)
		db, err := sql.Open("sqlite", path)
		if err != nil {
			t.Fatal(err)
		}
		defer db.Close()
		if _, err := db.Exec(`CREATE TABLE items(id INTEGER PRIMARY KEY)`); err != nil {
			t.Fatal(err)
		}
		return path
	}
	c := newRecordedAdditionalClient(t)
	code, _, body := c.do(t, "POST", "/api/connections", map[string]any{"name": "Prod DB", "engine": "sqlite", "database": touch("a.sqlite"), "tlsMode": "disable"})
	if code != 201 {
		t.Fatalf("first create: %d %s", code, body)
	}
	var first struct{ ID string }
	if err := json.Unmarshal(body, &first); err != nil {
		t.Fatal(err)
	}

	for _, name := range []string{"Prod DB", "prod db", "  PROD DB  "} {
		code, _, body = c.do(t, "POST", "/api/connections", map[string]any{"name": name, "engine": "sqlite", "database": touch("b.sqlite"), "tlsMode": "disable"})
		if code != 400 {
			t.Fatalf("create with colliding name %q: %d %s", name, code, body)
		}
	}

	secondPath := touch("c.sqlite")
	code, _, body = c.do(t, "POST", "/api/connections", map[string]any{"name": "Other DB", "engine": "sqlite", "database": secondPath, "tlsMode": "disable"})
	if code != 201 {
		t.Fatalf("second create: %d %s", code, body)
	}
	var second struct{ ID string }
	if err := json.Unmarshal(body, &second); err != nil {
		t.Fatal(err)
	}

	// Renaming the second connection to collide with the first is rejected.
	code, _, body = c.do(t, "PUT", "/api/connections/"+second.ID, map[string]any{"name": " prod db ", "engine": "sqlite", "database": secondPath, "tlsMode": "disable"})
	if code != 400 {
		t.Fatalf("update to colliding name: %d %s", code, body)
	}

	// Saving a connection under its own unchanged name is not a collision with itself.
	code, _, body = c.do(t, "PUT", "/api/connections/"+first.ID, map[string]any{"name": "Prod DB", "engine": "sqlite", "database": secondPath, "tlsMode": "disable"})
	if code != 200 {
		t.Fatalf("update keeping same name: %d %s", code, body)
	}
}

// Exercise routing and authentication without binding a network port.
type recordedAdditionalClient struct {
	handler http.Handler
	token   string
}

func newRecordedAdditionalClient(t *testing.T) recordedAdditionalClient {
	t.Helper()
	s, identity := personalServer(t)
	w := httptest.NewRecorder()
	s.issueSession(w, httptest.NewRequest("POST", "/api/auth/login", nil), identity, "unused", nil)
	var session struct{ AccessToken string }
	if err := json.Unmarshal(w.Body.Bytes(), &session); err != nil || session.AccessToken == "" {
		t.Fatalf("session: %s", w.Body.String())
	}
	return recordedAdditionalClient{s.Handler(), session.AccessToken}
}
func (c recordedAdditionalClient) do(t *testing.T, method, path string, body any) (int, http.Header, []byte) {
	t.Helper()
	data, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	r := httptest.NewRequest(method, path, bytes.NewReader(data))
	r.Header.Set("Authorization", "Bearer "+c.token)
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	c.handler.ServeHTTP(w, r)
	return w.Code, w.Header(), w.Body.Bytes()
}

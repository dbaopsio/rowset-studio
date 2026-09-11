package api

import (
	"encoding/json"
	"fmt"
	"math/rand"
	"net/http"
	"net/url"
	"os"
	"strings"
	"testing"
)

// TestLiveObjectDDL checks that every engine can show what an object is:
// its own definition for views, routines and triggers, and a CREATE TABLE
// built from the catalog where the engine has no such function.
func TestLiveObjectDDL(t *testing.T) {
	c := newE2EClient(t)
	for _, engine := range importEngines {
		t.Run(engine.engine, func(t *testing.T) {
			password := os.Getenv(engine.passwordEnv)
			if password == "" {
				t.Skip(engine.passwordEnv + " is not configured")
			}
			fixture := objectFixtures[engine.engine]
			connectionID := c.connection(t, engine, password)
			c.setPolicy(t, "deny_drop", false)
			suffix := fmt.Sprint(rand.Intn(1_000_000))
			named := func(sql string) string { return strings.ReplaceAll(sql, "{s}", suffix) }
			run := func(sql string) (int, string) {
				code, _, body := c.do(t, "POST", "/api/connections/"+connectionID+"/query", map[string]any{"sql": named(sql), "database": "rowset_e2e"})
				return code, string(body)
			}
			t.Cleanup(func() {
				for _, statement := range fixture.drop {
					run(statement)
				}
			})
			for _, statement := range fixture.create {
				if code, body := run(statement); code != http.StatusOK {
					t.Fatalf("%s -> %d %.300s", named(statement), code, body)
				}
			}
			ddl := func(kind, name string) string {
				t.Helper()
				path := fmt.Sprintf("/api/connections/%s/ddl?database=rowset_e2e&kind=%s&name=%s&schema=%s", connectionID, kind, url.QueryEscape(named(name)), url.QueryEscape(engine.schema))
				code, _, body := c.do(t, "GET", path, nil)
				var out struct{ SQL string }
				if code != http.StatusOK || json.Unmarshal(body, &out) != nil {
					t.Fatalf("%s %s: %d %.300s", kind, named(name), code, body)
				}
				return out.SQL
			}
			table := ddl("table", "obj_child_{s}")
			for _, want := range []string{"CREATE TABLE", "note", "parent_id", named("obj_child_note_{s}")} {
				if !strings.Contains(table, want) {
					t.Errorf("table DDL misses %q:\n%s", want, table)
				}
			}
			if view := ddl("view", "obj_view_{s}"); !strings.Contains(strings.ToUpper(view), "SELECT") {
				t.Errorf("view DDL:\n%s", view)
			}
			if procedure := ddl("procedure", "obj_proc_{s}"); !strings.Contains(strings.ToUpper(procedure), "INSERT") {
				t.Errorf("procedure DDL:\n%s", procedure)
			}
			if function := ddl("function", "obj_fn_{s}"); !strings.Contains(strings.ToUpper(function), "RETURN") {
				t.Errorf("function DDL:\n%s", function)
			}
			if trigger := ddl("trigger", "obj_trg_{s}"); !strings.Contains(strings.ToUpper(trigger), "INSERT") {
				t.Errorf("trigger DDL:\n%s", trigger)
			}
			if engine.engine != "mysql" {
				if sequence := ddl("sequence", "obj_seq_{s}"); !strings.Contains(strings.ToUpper(sequence), "SEQUENCE") {
					t.Errorf("sequence DDL:\n%s", sequence)
				}
			}
		})
	}
}

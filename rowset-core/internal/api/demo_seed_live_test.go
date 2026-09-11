package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

// TestLiveSeedDemoTables leaves an all_types table and a 20,000-row
// big_orders table in each test database for trying the Studio by hand.
// It runs only with ROWSET_SEED_DEMO=1 and replaces tables of those names.
func TestLiveSeedDemoTables(t *testing.T) {
	if os.Getenv("ROWSET_SEED_DEMO") != "1" {
		t.Skip("set ROWSET_SEED_DEMO=1 to seed demo tables")
	}
	for _, engine := range importEngines {
		t.Run(engine.engine, func(t *testing.T) {
			password := os.Getenv(engine.passwordEnv)
			if password == "" {
				t.Skip(engine.passwordEnv + " is not configured")
			}
			fixture := typeFixtures[engine.engine]
			s, identity := personalServer(t)
			body, _ := json.Marshal(map[string]any{"name": engine.engine, "engine": engine.engine, "host": "127.0.0.1", "port": engine.port, "database": "rowset_e2e", "connectionUsername": engine.user, "password": password, "tlsMode": "disable"})
			w := httptest.NewRecorder()
			s.createConnection(w, personalRequest(identity, string(body)))
			var connection struct{ ID string }
			if w.Code != http.StatusCreated || json.Unmarshal(w.Body.Bytes(), &connection) != nil {
				t.Fatalf("connection: %d %s", w.Code, w.Body.String())
			}
			for _, key := range []string{"deny_drop", "deny_select_without_where"} {
				toggle := personalRequest(identity, `{"enabled":false}`)
				toggle.Method = http.MethodPatch
				toggle.SetPathValue("key", key)
				s.togglePolicy(httptest.NewRecorder(), toggle)
			}
			run := func(sql string, optional bool) {
				t.Helper()
				encoded, _ := json.Marshal(map[string]any{"sql": sql})
				if w := importCall(t, s, identity, s.runQuery, "POST", connection.ID, "", string(encoded)); w.Code != http.StatusOK && !optional {
					t.Fatalf("%.120s: %d %s", sql, w.Code, w.Body.String())
				}
			}
			run("DROP TABLE big_orders", true)
			run("DROP TABLE all_types", true)
			if engine.engine == "postgres" {
				run("DROP TYPE mood_demo", true)
			}
			for _, statement := range fixture.setup {
				run(fmt.Sprintf(statement, "all_types", "demo"), false)
			}
			run(fmt.Sprintf(fixture.ddl, "all_types", "demo"), false)
			writable := strings.Join(fixture.writable(), ", ")
			for _, row := range []string{fixture.rows[0], fixture.rows[1], nulls(len(fixture.writable())), fixture.rows[0]} {
				run(fmt.Sprintf("INSERT INTO all_types (%s) VALUES (%s)", writable, row), false)
			}
			run("CREATE TABLE big_orders (id int PRIMARY KEY, customer_id int, status varchar(20), total decimal(12,2), note varchar(100))", false)
			digits := "(SELECT 0 AS n UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9)"
			run("INSERT INTO big_orders (id, customer_id, status, total, note) SELECT x.id, x.id % 500 + 1, CASE x.id % 4 WHEN 0 THEN 'new' WHEN 1 THEN 'paid' WHEN 2 THEN 'shipped' ELSE 'cancelled' END, (x.id % 997) * 1.25, CASE WHEN x.id % 10 = 0 THEN NULL ELSE 'order note' END FROM (SELECT a.n + b.n * 10 + c.n * 100 + d.n * 1000 + e.n * 10000 + 1 AS id FROM "+digits+" a, "+digits+" b, "+digits+" c, "+digits+" d, (SELECT 0 AS n UNION ALL SELECT 1) e) x", false)
		})
	}
}

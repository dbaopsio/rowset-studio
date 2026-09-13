package api

import (
	"encoding/json"
	"fmt"
	"math/rand"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

func TestLiveTableExport(t *testing.T) {
	for _, engine := range importEngines {
		t.Run(engine.engine, func(t *testing.T) {
			password := os.Getenv(engine.passwordEnv)
			if password == "" {
				t.Skip(engine.passwordEnv + " is not configured")
			}
			s, identity := personalServer(t)
			body, _ := json.Marshal(map[string]any{"name": engine.engine, "engine": engine.engine, "host": "127.0.0.1", "port": engine.port, "database": "rowset_e2e", "connectionUsername": engine.user, "password": password, "tlsMode": "disable"})
			w := httptest.NewRecorder()
			s.createConnection(w, personalRequest(identity, string(body)))
			var connection struct{ ID string }
			if w.Code != http.StatusCreated || json.Unmarshal(w.Body.Bytes(), &connection) != nil {
				t.Fatalf("connection: %d %s", w.Code, w.Body.String())
			}
			query := func(sql string) {
				t.Helper()
				encoded, _ := json.Marshal(map[string]any{"sql": sql})
				if w := importCall(t, s, identity, s.runQuery, "POST", connection.ID, "", string(encoded)); w.Code != http.StatusOK {
					t.Fatalf("%s: %d %s", sql, w.Code, w.Body.String())
				}
			}
			text := "varchar(40)"
			if engine.engine == "sqlserver" {
				text = "nvarchar(40)"
			}
			table := fmt.Sprintf("export_people_%d", rand.Intn(1_000_000))
			query(fmt.Sprintf("CREATE TABLE %s(id int primary key, name %s)", table, text))
			query("INSERT INTO " + table + " VALUES (1, 'a, b'), (2, NULL), (3, 'c')")
			export := func(format string) *httptest.ResponseRecorder {
				encoded, _ := json.Marshal(map[string]any{"schema": engine.schema, "table": table, "format": format})
				return importCall(t, s, identity, s.exportTable, "POST", connection.ID, "", string(encoded))
			}
			// The default "no SELECT without WHERE" policy covers exports too.
			if w := export("csv"); w.Code != http.StatusForbidden {
				t.Fatalf("export with the default policy: %d %s", w.Code, w.Body.String())
			}
			toggle := personalRequest(identity, `{"enabled":false}`)
			toggle.Method = http.MethodPatch
			toggle.SetPathValue("key", "deny_select_without_where")
			if w := httptest.NewRecorder(); func() bool { s.togglePolicy(w, toggle); return w.Code >= 300 }() {
				t.Fatal("could not turn off deny_select_without_where")
			}
			w = export("csv")
			// A UTF-8 BOM leads the file so Excel reads the encoding right.
			if w.Code != http.StatusOK || w.Header().Get("X-Rowset-Rows") != "3" || !strings.HasPrefix(w.Body.String(), "\ufeffid,name\n") || !strings.Contains(w.Body.String(), `1,"a, b"`) {
				t.Fatalf("csv export: %d %v %q", w.Code, w.Header(), w.Body.String())
			}
			w = export("json")
			var rows []map[string]any
			if w.Code != http.StatusOK || json.Unmarshal(w.Body.Bytes(), &rows) != nil || len(rows) != 3 || rows[1]["name"] != nil {
				t.Fatalf("json export: %d %s", w.Code, w.Body.String())
			}
			// SQL export: INSERT statements that quote the table and columns for
			// the engine, keep a comma inside a value, and write NULL for null.
			w = export("sql")
			sqlBody := w.Body.String()
			if w.Code != http.StatusOK || w.Header().Get("X-Rowset-Rows") != "3" {
				t.Fatalf("sql export: %d %v %q", w.Code, w.Header(), sqlBody)
			}
			wantTable := quoteSQLIdentifier(engine.engine, table)
			if engine.schema != "" {
				wantTable = quoteSQLIdentifier(engine.engine, engine.schema) + "." + wantTable
			}
			if !strings.Contains(sqlBody, "INSERT INTO "+wantTable+" ("+quoteSQLIdentifier(engine.engine, "id")+", "+quoteSQLIdentifier(engine.engine, "name")+") VALUES") {
				t.Fatalf("sql export header: %q", sqlBody)
			}
			if !strings.Contains(sqlBody, "(1, "+importLiteral(engine.engine, "a, b")+")") || !strings.Contains(sqlBody, "(2, NULL)") {
				t.Fatalf("sql export values: %q", sqlBody)
			}
			// The statements a database wrote must run again on the same engine.
			roundtrip := fmt.Sprintf("export_roundtrip_%d", rand.Intn(1_000_000))
			query(fmt.Sprintf("CREATE TABLE %s(id int primary key, name %s)", roundtrip, text))
			replay := strings.ReplaceAll(sqlBody, wantTable, quoteSQLIdentifier(engine.engine, roundtrip))
			for _, statement := range strings.Split(replay, ";\n") {
				if strings.TrimSpace(statement) == "" {
					continue
				}
				encoded, _ := json.Marshal(map[string]any{"sql": statement})
				if r := importCall(t, s, identity, s.runQuery, "POST", connection.ID, "", string(encoded)); r.Code != http.StatusOK {
					t.Fatalf("replaying the export failed: %d %s\n%s", r.Code, r.Body.String(), statement)
				}
			}
			// Policies apply to exports like any SELECT.
			policy, _ := json.Marshal(map[string]any{"name": "No export", "kind": "deny_table", "config": table})
			if w := importCall(t, s, identity, s.createCustomPolicy, "POST", "", "", string(policy)); w.Code != http.StatusCreated {
				t.Fatalf("policy: %d %s", w.Code, w.Body.String())
			}
			if w := export("csv"); w.Code != http.StatusForbidden {
				t.Fatalf("blocked table exported: %d %s", w.Code, w.Body.String())
			}
		})
	}
}

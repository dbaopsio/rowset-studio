package api

import (
	"encoding/json"
	"fmt"
	"math/rand"
	"net/http"
	"net/url"
	"os"
	"slices"
	"strings"
	"testing"
)

// TestLiveAllTypes runs every data-facing feature over the HTTP API against
// a table of all common column types on each engine: querying, explain,
// schema, row backup with restore by script (UPDATE) and by Restore
// (DELETE), CSV and JSON export, CSV import of the export, and the
// large-table paths. See e2eClient for running it against a desktop
// instance.
func TestLiveAllTypes(t *testing.T) {
	c := newE2EClient(t)
	for _, engine := range importEngines {
		t.Run(engine.engine, func(t *testing.T) {
			password := os.Getenv(engine.passwordEnv)
			if password == "" {
				t.Skip(engine.passwordEnv + " is not configured")
			}
			fixture := typeFixtures[engine.engine]
			connectionID := c.connection(t, engine, password)
			c.setPolicy(t, "deny_select_without_where", false)
			c.setPolicy(t, "deny_drop", false)
			c.setPolicy(t, "limit_rows", false)
			base := "/api/connections/" + connectionID

			call := func(sql string, extra map[string]any) (int, map[string]any, string) {
				payload := map[string]any{"sql": sql, "database": "rowset_e2e"}
				for key, value := range extra {
					payload[key] = value
				}
				code, _, body := c.do(t, "POST", base+"/query", payload)
				var out map[string]any
				_ = json.Unmarshal(body, &out)
				if code == http.StatusOK && out["error"] != nil {
					return http.StatusBadGateway, out, string(body)
				}
				return code, out, string(body)
			}
			must := func(sql string) map[string]any {
				t.Helper()
				code, out, raw := call(sql, nil)
				if code != http.StatusOK {
					t.Fatalf("%.200s: %d %.600s", sql, code, raw)
				}
				return out
			}
			suffix := fmt.Sprint(rand.Intn(1_000_000))
			table := "types_" + suffix
			var created []string
			t.Cleanup(func() {
				for index := len(created) - 1; index >= 0; index-- {
					call("DROP TABLE "+created[index], nil)
				}
				if engine.engine == "postgres" {
					call("DROP TYPE mood_"+suffix, nil)
				}
			})
			createTable := func(name string) {
				t.Helper()
				for _, statement := range fixture.statements(name, suffix) {
					if strings.HasPrefix(statement, "CREATE TYPE") && name != table {
						continue
					}
					must(statement)
				}
				created = append(created, name)
			}
			createTable(table)
			writable := strings.Join(fixture.writable(), ", ")
			for _, row := range fixture.rowValues() {
				must(fmt.Sprintf("INSERT INTO %s (%s) VALUES (%s)", table, writable, row))
			}
			snapshot := func(name string, columns []string) string {
				t.Helper()
				out := must("SELECT " + strings.Join(columns, ", ") + " FROM " + name + " WHERE id > 0 ORDER BY id")
				encoded, _ := json.Marshal(out["rows"])
				return string(encoded)
			}
			withID := append([]string{"id"}, fixture.compared()...)
			before := snapshot(table, withID)
			if strings.Count(before, "Ay") < 2 {
				t.Fatalf("unexpected snapshot: %.500s", before)
			}

			t.Run("explain and schema", func(t *testing.T) {
				if code, _, body := c.do(t, "POST", base+"/explain", map[string]any{"sql": "SELECT * FROM " + table + " WHERE id > 0", "database": "rowset_e2e"}); code != http.StatusOK {
					t.Errorf("explain: %d %.300s", code, body)
				}
				code, _, body := c.do(t, "GET", base+"/schema?database=rowset_e2e", nil)
				if code != http.StatusOK || !strings.Contains(string(body), table) || !strings.Contains(string(body), "c_int") {
					t.Errorf("schema: %d %.300s", code, body)
				}
			})
			backupID := func(result map[string]any) string {
				t.Helper()
				backup, ok := result["backup"].(map[string]any)
				if !ok {
					t.Fatalf("no backup: %v", result)
				}
				return backup["id"].(string)
			}
			t.Run("update backup and restore script", func(t *testing.T) {
				code, result, raw := call("UPDATE "+table+" SET "+fixture.update+" WHERE id <= 3", map[string]any{"backup": true})
				if code != http.StatusOK {
					t.Fatalf("update: %d %s", code, raw)
				}
				code, _, body := c.do(t, "GET", "/api/row-backups/"+backupID(result)+"/restore", nil)
				var script struct{ SQL string }
				if code != http.StatusOK || json.Unmarshal(body, &script) != nil {
					t.Fatalf("restore script: %d %s", code, body)
				}
				var lines []string
				for _, line := range strings.Split(script.SQL, "\n") {
					if !strings.HasPrefix(line, "--") {
						lines = append(lines, line)
					}
				}
				for _, statement := range strings.Split(strings.Join(lines, "\n"), ";\n") {
					if statement = strings.TrimSpace(statement); statement != "" {
						if code, _, raw := call(statement, nil); code != http.StatusOK {
							t.Fatalf("restore statement: %d %.600s\n%.2000s", code, raw, statement)
						}
					}
				}
				if got := snapshot(table, withID); got != before {
					t.Errorf("restored rows differ\nwant %s\ngot  %s", before, got)
				}
			})
			t.Run("delete backup and restore", func(t *testing.T) {
				code, result, raw := call("DELETE FROM "+table+" WHERE id IN (1, 2, 3)", map[string]any{"backup": true})
				if code != http.StatusOK {
					t.Fatalf("delete: %d %s", code, raw)
				}
				if code, _, body := c.do(t, "POST", "/api/row-backups/"+backupID(result)+"/apply", nil); code != http.StatusOK {
					t.Fatalf("restore: %d %.600s", code, body)
				}
				if got := snapshot(table, withID); got != before {
					t.Errorf("restored rows differ\nwant %s\ngot  %s", before, got)
				}
			})
			export := func(name, format string) (int, http.Header, []byte) {
				return c.do(t, "POST", base+"/export", map[string]any{"database": "rowset_e2e", "schema": engine.schema, "table": name, "format": format})
			}
			t.Run("export and import", func(t *testing.T) {
				code, headers, body := export(table, "json")
				var rows []map[string]any
				if code != http.StatusOK || headers.Get("X-Rowset-Rows") != "4" || json.Unmarshal(body, &rows) != nil || len(rows) != 4 {
					t.Errorf("json export: %d %.300s", code, body)
				}
				code, headers, csvBody := export(table, "csv")
				if code != http.StatusOK || headers.Get("X-Rowset-Rows") != "4" {
					t.Fatalf("csv export: %d %.300s", code, csvBody)
				}
				clone := table + "_copy"
				createTable(clone)
				sources := strings.Split(strings.SplitN(string(csvBody), "\n", 2)[0], ",")
				var mapping []map[string]any
				for _, column := range fixture.writable() {
					mapping = append(mapping, map[string]any{"source": slices.Index(sources, column), "target": column})
				}
				code, _, body = c.do(t, "POST", base+"/imports", nil)
				var started struct{ ImportID string }
				if code != http.StatusCreated || json.Unmarshal(body, &started) != nil {
					t.Fatalf("start import: %d %s", code, body)
				}
				importPath := base + "/imports/" + url.PathEscape(started.ImportID)
				if code, _, body := c.do(t, "PUT", importPath, string(csvBody)); code != http.StatusOK {
					t.Fatalf("upload: %d %s", code, body)
				}
				if code, _, body := c.do(t, "POST", importPath+"/run", map[string]any{"database": "rowset_e2e", "schema": engine.schema, "table": clone, "header": true, "delimiter": ",", "nullEmpty": true, "columns": mapping}); code != http.StatusOK {
					t.Fatalf("import: %d %.600s", code, body)
				}
				// Empty strings become NULL on import, and the export is not in id
				// order, so compare the sorted rows.
				sorted := func(name string) string {
					var rows []json.RawMessage
					_ = json.Unmarshal([]byte(strings.ReplaceAll(snapshot(name, fixture.importCompared()), `""`, "null")), &rows)
					slices.SortFunc(rows, func(a, b json.RawMessage) int { return strings.Compare(string(a), string(b)) })
					encoded, _ := json.Marshal(rows)
					return string(encoded)
				}
				if want, got := sorted(table), sorted(clone); got != want {
					t.Errorf("imported rows differ\nwant %s\ngot  %s", want, got)
				}
			})
			t.Run("large table", func(t *testing.T) {
				big := table + "_big"
				must("CREATE TABLE " + big + " (id int PRIMARY KEY, v int)")
				created = append(created, big)
				digits := "(SELECT 0 AS n UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9)"
				must("INSERT INTO " + big + " (id, v) SELECT a.n + b.n * 10 + c.n * 100 + d.n * 1000 + e.n * 10000 + 1, 0 FROM " + digits + " a, " + digits + " b, " + digits + " c, " + digits + " d, (SELECT 0 AS n UNION ALL SELECT 1) e")
				if code, _, raw := call("UPDATE "+big+" SET v = 1 WHERE id > 0", map[string]any{"backup": true}); code != http.StatusConflict {
					t.Errorf("over-limit update with backup: %d %.200s", code, raw)
				}
				if code, out, raw := call("UPDATE "+big+" SET v = 1 WHERE id > 0", nil); code != http.StatusOK || out["rowCount"] != float64(20000) {
					t.Errorf("update without backup: %d %.200s", code, raw)
				}
				// Without a policy nothing caps a result: every row comes back.
				if code, out, raw := call("SELECT * FROM "+big+" WHERE id > 0", nil); code != http.StatusOK || out["truncated"] != false || len(out["rows"].([]any)) != 20000 {
					t.Errorf("uncapped select: %d %.200s", code, raw)
				}
				// A client may still ask for fewer rows.
				if code, out, raw := call("SELECT * FROM "+big+" WHERE id > 0", map[string]any{"maxRows": 1000}); code != http.StatusOK || out["truncated"] != true || len(out["rows"].([]any)) != 1000 {
					t.Errorf("client-capped select: %d %.200s", code, raw)
				}
				if code, headers, body := export(big, "csv"); code != http.StatusOK || headers.Get("X-Rowset-Rows") != "20000" {
					t.Errorf("large export: %d %.200s", code, body)
				}
				// Studio reads results over NDJSON: every row arrives there too.
				if code, rows, complete := c.stream(t, connectionID, map[string]any{"sql": "SELECT * FROM " + big + " WHERE id > 0", "database": "rowset_e2e"}); code != http.StatusOK || rows != 20000 || complete["truncated"] != false {
					t.Errorf("ndjson stream: %d rows=%d %v", code, rows, complete)
				}
				// Every shape of SELECT still runs with the row limit on.
				shapes := []string{
					"SELECT DISTINCT v FROM " + big + " WHERE id > 0",
					"SELECT * FROM " + big + " WHERE id > 0 ORDER BY id DESC",
					"WITH picked AS (SELECT id FROM " + big + " WHERE id > 0) SELECT * FROM picked",
					"SELECT id FROM " + big + " WHERE id = 1 UNION SELECT id FROM " + big + " WHERE id = 2",
				}
				if engine.engine == "mysql" || engine.engine == "mariadb" {
					shapes = append(shapes, "SELECT * FROM "+big+" WHERE id > 0 LIMIT 100, 400")
				}
				if engine.engine != "sqlserver" {
					shapes = append(shapes, "SELECT * FROM "+big+" WHERE id > 0 FOR UPDATE")
				}
				// With the row-limit policy on, the cap applies and says so.
				if code, _, body := c.do(t, "PATCH", "/api/policies/limit_rows", map[string]any{"enabled": true, "value": "50"}); code >= 300 {
					t.Fatalf("limit_rows: %d %s", code, body)
				}
				if code, out, raw := call("SELECT * FROM "+big+" WHERE id > 0", nil); code != http.StatusOK || out["truncated"] != true || len(out["rows"].([]any)) != 50 || !strings.Contains(fmt.Sprint(out["policyNotice"]), "policy") {
					t.Errorf("policy-capped select: %d %.200s", code, raw)
				}
				// An export follows the same policy.
				if code, headers, body := export(big, "csv"); code != http.StatusOK || headers.Get("X-Rowset-Rows") != "50" {
					t.Errorf("policy-capped export: %d %v %.200s", code, headers, body)
				}
				for _, shape := range shapes {
					code, out, raw := call(shape, nil)
					if code != http.StatusOK {
						t.Errorf("%s: %d %.300s", shape, code, raw)
						continue
					}
					if rows := out["rows"].([]any); len(rows) > 50 {
						t.Errorf("%s returned %d rows with a 50-row policy", shape, len(rows))
					}
				}
				if code, _, body := c.do(t, "PATCH", "/api/policies/limit_rows", map[string]any{"enabled": false}); code >= 300 {
					t.Fatalf("limit_rows off: %d %s", code, body)
				}

			})
		})
	}
}

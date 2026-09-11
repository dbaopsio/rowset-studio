package api

import (
	"encoding/json"
	"fmt"
	"math/rand"
	"net/http"
	"net/http/httptest"
	"os"
	"slices"
	"strings"
	"testing"
)

// typeFixture is a table holding every commonly used column type of one
// engine, with a full row, an all-NULL row and a row of edge values.
type typeFixture struct {
	setup   []string // statements run before the table is created; %[2]s is a unique suffix
	ddl     string   // %[1]s is the table name, %[2]s the unique suffix
	columns []string // every column except id
	// computed columns are derived by the database; they are compared but
	// never written.
	computed []string
	// volatile columns change on every write and are left out of comparisons.
	volatile []string
	rows     []string // value lists for the writable columns, in order
	update   string   // SET clause of the UPDATE that is backed up and restored
}

func nulls(count int) string {
	return strings.TrimSuffix(strings.Repeat("NULL, ", count), ", ")
}

var mysqlColumns = []string{"c_tinyint", "c_smallint", "c_mediumint", "c_int", "c_bigint", "c_ubigint", "c_decimal", "c_float", "c_double", "c_bit", "c_bool", "c_char", "c_varchar", "c_text", "c_date", "c_time", "c_datetime", "c_timestamp", "c_year", "c_json", "c_binary", "c_varbinary", "c_blob", "c_enum", "c_set", "c_point"}

const mysqlDDL = "id int AUTO_INCREMENT PRIMARY KEY, c_tinyint tinyint, c_smallint smallint, c_mediumint mediumint, c_int int, c_bigint bigint, c_ubigint bigint unsigned, c_decimal decimal(12,4), c_float float, c_double double, c_bit bit(4), c_bool boolean, c_char char(3), c_varchar varchar(50), c_text text, c_date date, c_time time(3), c_datetime datetime(3), c_timestamp timestamp(3) NULL, c_year year, c_json json, c_binary binary(4), c_varbinary varbinary(16), c_blob blob, c_enum enum('sad','ok','happy'), c_set set('x','y','z'), c_point point NULL"

var mysqlRows = []string{
	`1, 2, 3, 4, 9223372036854775807, 18446744073709551615, 12345678.1234, 1.5, 2.25, b'1010', true, 'abc', 'Ayşe O''Neil', 'line1\nline2 \\ back', '2024-02-29', '13:45:10.123', '2024-03-01 10:15:30.250', '2024-03-01 10:15:30.250', 2024, '{"a": "x\\"y", "b": [1, 2]}', X'00FF1000', X'00FF10', X'616263', 'happy', 'x,z', ST_GeomFromText('POINT(1 2)')`,
	`-128, -32768, -8388608, -1, -9223372036854775808, 0, -0.0001, -1.25e10, 1e-300, b'0000', false, 'x', '', 'ğüşİ 😀 ''q'' "dq"', '1000-01-01', '-838:59:59.000', '1970-01-01 00:00:00.000', '1970-01-02 00:00:00.000', 1901, '[]', X'00000000', X'', X'', 'sad', '', ST_GeomFromText('POINT(0 0)')`,
}

var typeFixtures = map[string]typeFixture{
	"postgres": {
		setup:    []string{"CREATE TYPE mood_%[2]s AS ENUM ('sad', 'ok', 'happy')"},
		ddl:      "CREATE TABLE %[1]s (id int GENERATED ALWAYS AS IDENTITY PRIMARY KEY, c_smallint smallint, c_int integer, c_bigint bigint, c_numeric numeric(12,4), c_real real, c_double double precision, c_money money, c_bool boolean, c_char char(3), c_varchar varchar(50), c_text text, c_date date, c_time time(3), c_timestamp timestamp(3), c_timestamptz timestamptz(3), c_interval interval, c_uuid uuid, c_json json, c_jsonb jsonb, c_bytea bytea, c_inet inet, c_cidr cidr, c_macaddr macaddr, c_int_array int[], c_text_array text[], c_xml xml, c_point point, c_enum mood_%[2]s, c_bit bit(4), c_varbit varbit(8), c_generated int GENERATED ALWAYS AS (c_int * 2) STORED)",
		columns:  []string{"c_smallint", "c_int", "c_bigint", "c_numeric", "c_real", "c_double", "c_money", "c_bool", "c_char", "c_varchar", "c_text", "c_date", "c_time", "c_timestamp", "c_timestamptz", "c_interval", "c_uuid", "c_json", "c_jsonb", "c_bytea", "c_inet", "c_cidr", "c_macaddr", "c_int_array", "c_text_array", "c_xml", "c_point", "c_enum", "c_bit", "c_varbit", "c_generated"},
		computed: []string{"c_generated"},
		rows: []string{
			`1, 2, 9223372036854775807, 12345678.1234, 1.5, 2.25, 12.34, true, 'abc', 'Ayşe O''Neil', 'line1
line2 \ back', '2024-02-29', '13:45:10.123', '2024-03-01 10:15:30.250', '2024-03-01 10:15:30.25+03', '1 day 02:03:04', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', '{"a": "x\"y", "b": [1, 2]}', '{"k": true}', '\x00ff10', '192.168.1.10', '10.0.0.0/8', '08:00:2b:01:02:03', '{1,2,NULL}', '{"a b","c,d"}', '<r a="1">x</r>', '(1.5,2)', 'happy', B'1010', B'101'`,
			`-32768, -1, -9223372036854775808, -0.0001, -1.25e10, 1e-300, -5.5, false, 'x', '', 'ğüşİ 😀 ''q'' "dq"', '1999-12-31', '00:00:00', '1970-01-01 00:00:00', '1970-01-01 00:00:00+00', '-3 months', '00000000-0000-0000-0000-000000000000', '[]', '{}', '\x', '::1', '::/0', 'ff:ff:ff:ff:ff:ff', '{}', '{}', '<e/>', '(0,0)', 'sad', B'0000', B''`,
		},
		update: "c_int = 0, c_text = 'changed', c_date = '2000-01-01', c_bytea = NULL, c_jsonb = '{}', c_int_array = '{9}', c_enum = 'ok'",
	},
	"mysql": {
		ddl:      "CREATE TABLE %[1]s (" + mysqlDDL + ", c_generated int GENERATED ALWAYS AS (c_int * 2) STORED) CHARACTER SET utf8mb4",
		columns:  append(slices.Clone(mysqlColumns), "c_generated"),
		computed: []string{"c_generated"},
		rows:     mysqlRows,
		update:   "c_int = 0, c_text = 'changed', c_date = '2000-01-01', c_blob = NULL, c_json = '{}', c_set = 'y', c_point = ST_GeomFromText('POINT(5 5)')",
	},
	"mariadb": {
		ddl:      "CREATE TABLE %[1]s (" + mysqlDDL + ", c_uuid uuid, c_inet6 inet6, c_generated int GENERATED ALWAYS AS (c_int * 2) STORED) CHARACTER SET utf8mb4",
		columns:  append(slices.Clone(mysqlColumns), "c_uuid", "c_inet6", "c_generated"),
		computed: []string{"c_generated"},
		rows:     []string{mysqlRows[0] + `, 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', '2001:db8::1'`, mysqlRows[1] + `, '00000000-0000-0000-0000-000000000000', '::ffff:10.0.0.1'`},
		update:   "c_int = 0, c_text = 'changed', c_date = '2000-01-01', c_blob = NULL, c_json = '{}', c_set = 'y', c_uuid = NULL",
	},
	"sqlserver": {
		ddl:      "CREATE TABLE %[1]s (id int IDENTITY(1,1) PRIMARY KEY, c_tinyint tinyint, c_smallint smallint, c_int int, c_bigint bigint, c_decimal decimal(12,4), c_numeric numeric(10,2), c_float float, c_real real, c_money money, c_smallmoney smallmoney, c_bit bit, c_char char(3), c_varchar varchar(50), c_nchar nchar(3), c_nvarchar nvarchar(50), c_nvarchar_max nvarchar(max), c_date date, c_time time(3), c_datetime datetime, c_datetime2 datetime2(3), c_smalldatetime smalldatetime, c_dto datetimeoffset(3), c_uuid uniqueidentifier, c_binary binary(4), c_varbinary varbinary(16), c_xml xml, c_rowversion rowversion, c_computed AS (c_int * 2))",
		columns:  []string{"c_tinyint", "c_smallint", "c_int", "c_bigint", "c_decimal", "c_numeric", "c_float", "c_real", "c_money", "c_smallmoney", "c_bit", "c_char", "c_varchar", "c_nchar", "c_nvarchar", "c_nvarchar_max", "c_date", "c_time", "c_datetime", "c_datetime2", "c_smalldatetime", "c_dto", "c_uuid", "c_binary", "c_varbinary", "c_xml", "c_rowversion", "c_computed"},
		computed: []string{"c_rowversion", "c_computed"},
		volatile: []string{"c_rowversion"},
		rows: []string{
			`1, 2, 3, 9223372036854775807, 12345678.1234, 12.34, 2.25, 1.5, 12.3456, 1.25, 1, 'abc', 'O''Neil', N'ğüş', N'Ayşe O''Neil 😀', N'line1
line2 \ back', '2024-02-29', '13:45:10.123', '2024-03-01 10:15:30.250', '2024-03-01 10:15:30.250', '2024-03-01 10:15:00', '2024-03-01 10:15:30.250 +03:00', 'A0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11', 0x00FF1000, 0x00FF10, N'<r a="1">x</r>'`,
			`0, -32768, -1000000000, -9223372036854775808, -0.0001, -1.00, -1.25e10, 1e-30, -5.5, -1, 0, 'x', '', N'', N'ğüşİ ''q'' "dq"', N'', '0001-01-01', '00:00:00', '1753-01-01 00:00:00', '0001-01-01 00:00:00', '1900-01-01 00:00:00', '0001-01-01 00:00:00 +00:00', '00000000-0000-0000-0000-000000000000', 0x00000000, 0x, N'<e/>'`,
		},
		update: "c_int = 0, c_nvarchar = N'changed', c_date = '2000-01-01', c_varbinary = NULL, c_xml = N'<z/>', c_dto = NULL",
	},
}

func (f typeFixture) writable() []string {
	var out []string
	for _, column := range f.columns {
		if !slices.Contains(f.computed, column) {
			out = append(out, column)
		}
	}
	return out
}

func (f typeFixture) compared() []string {
	var out []string
	for _, column := range f.columns {
		if !slices.Contains(f.volatile, column) {
			out = append(out, column)
		}
	}
	return out
}

// TestLiveAllTypes runs every data-facing feature against a table of all
// common column types on each engine: querying, explain, schema, row backup
// and restore for UPDATE and DELETE, export, CSV import of the export, and
// the large-table paths.
func TestLiveAllTypes(t *testing.T) {
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
			toggle := personalRequest(identity, `{"enabled":false}`)
			toggle.Method = http.MethodPatch
			toggle.SetPathValue("key", "deny_select_without_where")
			s.togglePolicy(httptest.NewRecorder(), toggle)

			call := func(sql string, extra map[string]any) (int, map[string]any, string) {
				payload := map[string]any{"sql": sql}
				for key, value := range extra {
					payload[key] = value
				}
				encoded, _ := json.Marshal(payload)
				w := importCall(t, s, identity, s.runQuery, "POST", connection.ID, "", string(encoded))
				var out map[string]any
				_ = json.Unmarshal(w.Body.Bytes(), &out)
				return w.Code, out, w.Body.String()
			}
			must := func(sql string) map[string]any {
				t.Helper()
				code, out, raw := call(sql, nil)
				if code != http.StatusOK {
					t.Fatalf("%s: %d %s", sql, code, raw)
				}
				return out
			}
			suffix := fmt.Sprint(rand.Intn(1_000_000))
			table := "types_" + suffix
			for _, statement := range fixture.setup {
				must(fmt.Sprintf(statement, table, suffix))
			}
			createTable := func(name string) {
				t.Helper()
				must(fmt.Sprintf(fixture.ddl, name, suffix))
			}
			createTable(table)
			writable := strings.Join(fixture.writable(), ", ")
			values := append(slices.Clone(fixture.rows), nulls(len(fixture.writable())))
			// Row order: full values, edge values, all NULL, full values again.
			values = []string{values[0], values[1], values[2], values[0]}
			for _, row := range values {
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
			if !strings.Contains(before, "Ay") {
				t.Fatalf("unexpected snapshot: %s", before)
			}

			restore := func(label string, result map[string]any) {
				t.Helper()
				backup, ok := result["backup"].(map[string]any)
				if !ok {
					t.Errorf("%s: no backup: %v", label, result)
					return
				}
				r := personalRequest(identity, "")
				r.SetPathValue("id", backup["id"].(string))
				w := httptest.NewRecorder()
				s.rowBackupRestore(w, r)
				var script struct{ SQL string }
				if w.Code != http.StatusOK || json.Unmarshal(w.Body.Bytes(), &script) != nil {
					t.Errorf("%s: restore script: %d %s", label, w.Code, w.Body.String())
					return
				}
				var lines []string
				for _, line := range strings.Split(script.SQL, "\n") {
					if !strings.HasPrefix(line, "--") {
						lines = append(lines, line)
					}
				}
				for _, statement := range strings.Split(strings.Join(lines, "\n"), ";\n") {
					if statement = strings.TrimSpace(statement); statement == "" {
						continue
					}
					if code, _, raw := call(statement, nil); code != http.StatusOK {
						t.Errorf("%s: restore statement failed: %d %s\n%s", label, code, raw, statement)
						return
					}
				}
				if got := snapshot(table, withID); got != before {
					t.Errorf("%s: restored rows differ\nwant %s\ngot  %s", label, before, got)
				}
			}

			t.Run("explain and schema", func(t *testing.T) {
				encoded, _ := json.Marshal(map[string]any{"sql": "SELECT * FROM " + table + " WHERE id > 0"})
				if w := importCall(t, s, identity, s.explainQuery, "POST", connection.ID, "", string(encoded)); w.Code != http.StatusOK {
					t.Errorf("explain: %d %s", w.Code, w.Body.String())
				}
				r := personalRequest(identity, "")
				r.Method = http.MethodGet
				r.SetPathValue("id", connection.ID)
				r.URL.RawQuery = "database=rowset_e2e"
				w := httptest.NewRecorder()
				s.connectionSchema(w, r)
				if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), table) || !strings.Contains(w.Body.String(), "c_int") {
					t.Errorf("schema: %d %.300s", w.Code, w.Body.String())
				}
			})
			t.Run("update backup and restore", func(t *testing.T) {
				code, result, raw := call("UPDATE "+table+" SET "+fixture.update+" WHERE id <= 3", map[string]any{"backup": true})
				if code != http.StatusOK {
					t.Fatalf("update: %d %s", code, raw)
				}
				restore("update", result)
			})
			t.Run("delete backup and restore", func(t *testing.T) {
				code, result, raw := call("DELETE FROM "+table+" WHERE id IN (1, 2, 3)", map[string]any{"backup": true})
				if code != http.StatusOK {
					t.Fatalf("delete: %d %s", code, raw)
				}
				// Deleted rows come back through Restore, which also handles
				// identity columns.
				backup, ok := result["backup"].(map[string]any)
				if !ok {
					t.Fatalf("no backup: %v", result)
				}
				r := personalRequest(identity, "")
				r.Method = http.MethodPost
				r.SetPathValue("id", backup["id"].(string))
				w := httptest.NewRecorder()
				s.applyRowBackup(w, r)
				if w.Code != http.StatusOK {
					t.Fatalf("apply: %d %s", w.Code, w.Body.String())
				}
				if got := snapshot(table, withID); got != before {
					t.Errorf("restored rows differ\nwant %s\ngot  %s", before, got)
				}
			})
			t.Run("export and import", func(t *testing.T) {
				export := func(format string) *httptest.ResponseRecorder {
					encoded, _ := json.Marshal(map[string]any{"schema": engine.schema, "table": table, "format": format})
					return importCall(t, s, identity, s.exportTable, "POST", connection.ID, "", string(encoded))
				}
				if w := export("json"); w.Code != http.StatusOK || w.Header().Get("X-Rowset-Rows") != "4" {
					t.Errorf("json export: %d %.300s", w.Code, w.Body.String())
				}
				csvExport := export("csv")
				if csvExport.Code != http.StatusOK || csvExport.Header().Get("X-Rowset-Rows") != "4" {
					t.Fatalf("csv export: %d %.300s", csvExport.Code, csvExport.Body.String())
				}
				// Import the export into an empty copy of the table.
				clone := table + "_copy"
				createTable(clone)
				header := strings.SplitN(csvExport.Body.String(), "\n", 2)[0]
				sources := strings.Split(header, ",")
				var mapping []map[string]any
				for _, column := range fixture.writable() {
					mapping = append(mapping, map[string]any{"source": slices.Index(sources, column), "target": column})
				}
				w := importCall(t, s, identity, s.startImport, "POST", connection.ID, "", "")
				var started struct{ ImportID string }
				if w.Code != http.StatusCreated || json.Unmarshal(w.Body.Bytes(), &started) != nil {
					t.Fatalf("start import: %d %s", w.Code, w.Body.String())
				}
				if w := importCall(t, s, identity, s.appendImport, "PUT", connection.ID, started.ImportID, csvExport.Body.String()); w.Code != http.StatusOK {
					t.Fatalf("upload: %d %s", w.Code, w.Body.String())
				}
				run, _ := json.Marshal(map[string]any{"schema": engine.schema, "table": clone, "header": true, "delimiter": ",", "nullEmpty": true, "columns": mapping})
				if w := importCall(t, s, identity, s.runImport, "POST", connection.ID, started.ImportID, string(run)); w.Code != http.StatusOK {
					t.Fatalf("import: %d %s", w.Code, w.Body.String())
				}
				// Empty strings become NULL on import, and the export is not in id
				// order, so compare the sorted rows.
				sorted := func(name string) string {
					var rows []json.RawMessage
					_ = json.Unmarshal([]byte(strings.ReplaceAll(snapshot(name, fixture.compared()), `""`, "null")), &rows)
					slices.SortFunc(rows, func(a, b json.RawMessage) int { return strings.Compare(string(a), string(b)) })
					encoded, _ := json.Marshal(rows)
					return string(encoded)
				}
				want := sorted(table)
				if got := sorted(clone); got != want {
					t.Errorf("imported rows differ\nwant %s\ngot  %s", want, got)
				}
			})
			t.Run("large table", func(t *testing.T) {
				big := table + "_big"
				must("CREATE TABLE " + big + " (id int PRIMARY KEY, v int)")
				digits := "(SELECT 0 AS n UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9)"
				must("INSERT INTO " + big + " (id, v) SELECT a.n + b.n * 10 + c.n * 100 + d.n * 1000 + e.n * 10000 + 1, 0 FROM " + digits + " a, " + digits + " b, " + digits + " c, " + digits + " d, (SELECT 0 AS n UNION ALL SELECT 1) e")
				if code, _, raw := call("UPDATE "+big+" SET v = 1 WHERE id > 0", map[string]any{"backup": true}); code != http.StatusConflict {
					t.Errorf("over-limit update with backup: %d %s", code, raw)
				}
				if code, out, raw := call("UPDATE "+big+" SET v = 1 WHERE id > 0", nil); code != http.StatusOK || out["rowCount"] != float64(20000) {
					t.Errorf("update without backup: %d %.200s", code, raw)
				}
				if code, out, raw := call("SELECT * FROM "+big+" WHERE id > 0", map[string]any{"maxRows": 1000}); code != http.StatusOK || out["truncated"] != true || len(out["rows"].([]any)) != 1000 {
					t.Errorf("capped select: %d %.200s", code, raw)
				}
				encoded, _ := json.Marshal(map[string]any{"schema": engine.schema, "table": big, "format": "csv"})
				if w := importCall(t, s, identity, s.exportTable, "POST", connection.ID, "", string(encoded)); w.Code != http.StatusOK || w.Header().Get("X-Rowset-Rows") != "20000" {
					t.Errorf("large export: %d %v", w.Code, w.Header())
				}
			})
		})
	}
}

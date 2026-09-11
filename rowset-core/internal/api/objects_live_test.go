package api

import (
	"encoding/json"
	"fmt"
	"math/rand"
	"net/http"
	"os"
	"strings"
	"testing"
)

// objectFixture creates tables with keys, an index, a view, a function, a
// procedure, a trigger and (where the engine has them) a sequence, then uses
// each one through the editor's query API.
type objectFixture struct {
	create  []string // {s} is a unique suffix
	use     []objectCheck
	drop    []string
	objects []string // names the schema browser must list
}

type objectCheck struct {
	sql  string
	want string // expected in the JSON rows of the result; "" means any success
}

var objectFixtures = map[string]objectFixture{
	"postgres": {
		create: []string{
			"CREATE TABLE obj_parent_{s} (id int PRIMARY KEY, name text UNIQUE, amount numeric CHECK (amount >= 0))",
			"CREATE TABLE obj_child_{s} (id int PRIMARY KEY, parent_id int REFERENCES obj_parent_{s}(id), note text)",
			"CREATE INDEX obj_child_note_{s} ON obj_child_{s} (note, parent_id)",
			"CREATE VIEW obj_view_{s} AS SELECT c.id, p.name, c.note FROM obj_child_{s} c JOIN obj_parent_{s} p ON p.id = c.parent_id",
			"CREATE FUNCTION obj_fn_{s}(x int) RETURNS int LANGUAGE sql AS $$ SELECT x * 2 $$",
			"CREATE PROCEDURE obj_proc_{s}(x int) LANGUAGE plpgsql AS $$\nBEGIN\n  INSERT INTO obj_parent_{s} VALUES (x, 'p' || x, 1);\n  INSERT INTO obj_parent_{s} VALUES (x + 100, 'p' || (x + 100), 2);\nEND\n$$",
			"CREATE FUNCTION obj_trg_fn_{s}() RETURNS trigger LANGUAGE plpgsql AS $$\nBEGIN\n  NEW.note := upper(NEW.note);\n  RETURN NEW;\nEND\n$$",
			"CREATE TRIGGER obj_trg_{s} BEFORE INSERT ON obj_child_{s} FOR EACH ROW EXECUTE FUNCTION obj_trg_fn_{s}()",
			"CREATE SEQUENCE obj_seq_{s}",
		},
		use: []objectCheck{
			{sql: "CALL obj_proc_{s}(1)"},
			{sql: "INSERT INTO obj_child_{s} VALUES (1, 1, 'hello')"},
			{sql: "SELECT note FROM obj_child_{s} WHERE id = 1", want: "HELLO"},
			{sql: "SELECT obj_fn_{s}(21)", want: "42"},
			{sql: "SELECT name, note FROM obj_view_{s} WHERE id = 1", want: "p1"},
			{sql: "SELECT nextval('obj_seq_{s}')", want: "1"},
			{sql: "SELECT count(*) FROM obj_parent_{s} WHERE id > 0", want: "2"},
		},
		drop:    []string{"DROP VIEW obj_view_{s}", "DROP TABLE obj_child_{s}", "DROP TABLE obj_parent_{s}", "DROP FUNCTION obj_trg_fn_{s}()", "DROP FUNCTION obj_fn_{s}(int)", "DROP PROCEDURE obj_proc_{s}(int)", "DROP SEQUENCE obj_seq_{s}"},
		objects: []string{"obj_view_{s}", "obj_fn_{s}", "obj_proc_{s}", "obj_trg_{s}", "obj_child_note_{s}"},
	},
	"mysql": {
		create: []string{
			"CREATE TABLE obj_parent_{s} (id int PRIMARY KEY, name varchar(40) UNIQUE, amount decimal(10,2) CHECK (amount >= 0))",
			"CREATE TABLE obj_child_{s} (id int PRIMARY KEY, parent_id int, note varchar(40), FOREIGN KEY (parent_id) REFERENCES obj_parent_{s}(id))",
			"CREATE INDEX obj_child_note_{s} ON obj_child_{s} (note, parent_id)",
			"CREATE VIEW obj_view_{s} AS SELECT c.id, p.name, c.note FROM obj_child_{s} c JOIN obj_parent_{s} p ON p.id = c.parent_id",
			"CREATE FUNCTION obj_fn_{s}(x INT) RETURNS INT DETERMINISTIC RETURN x * 2",
			"CREATE PROCEDURE obj_proc_{s}(IN x INT)\nBEGIN\n  INSERT INTO obj_parent_{s} VALUES (x, CONCAT('p', x), 1);\n  INSERT INTO obj_parent_{s} VALUES (x + 100, CONCAT('p', x + 100), 2);\nEND",
			"CREATE TRIGGER obj_trg_{s} BEFORE INSERT ON obj_child_{s} FOR EACH ROW SET NEW.note = UPPER(NEW.note)",
		},
		use: []objectCheck{
			{sql: "CALL obj_proc_{s}(1)"},
			{sql: "INSERT INTO obj_child_{s} VALUES (1, 1, 'hello')"},
			{sql: "SELECT note FROM obj_child_{s} WHERE id = 1", want: "HELLO"},
			{sql: "SELECT obj_fn_{s}(21)", want: "42"},
			{sql: "SELECT name, note FROM obj_view_{s} WHERE id = 1", want: "p1"},
			{sql: "SELECT count(*) FROM obj_parent_{s} WHERE id > 0", want: "2"},
		},
		drop:    []string{"DROP VIEW obj_view_{s}", "DROP TABLE obj_child_{s}", "DROP TABLE obj_parent_{s}", "DROP FUNCTION obj_fn_{s}", "DROP PROCEDURE obj_proc_{s}"},
		objects: []string{"obj_view_{s}", "obj_fn_{s}", "obj_proc_{s}", "obj_trg_{s}", "obj_child_note_{s}"},
	},
	"sqlserver": {
		create: []string{
			"CREATE TABLE obj_parent_{s} (id int PRIMARY KEY, name nvarchar(40) UNIQUE, amount decimal(10,2) CHECK (amount >= 0))",
			"CREATE TABLE obj_child_{s} (id int PRIMARY KEY, parent_id int REFERENCES obj_parent_{s}(id), note nvarchar(40))",
			"CREATE INDEX obj_child_note_{s} ON obj_child_{s} (note, parent_id)",
			"CREATE VIEW obj_view_{s} AS SELECT c.id, p.name, c.note FROM obj_child_{s} c JOIN obj_parent_{s} p ON p.id = c.parent_id",
			"CREATE FUNCTION dbo.obj_fn_{s}(@x int) RETURNS int AS BEGIN RETURN @x * 2 END",
			"CREATE PROCEDURE dbo.obj_proc_{s} @x int AS\nBEGIN\n  INSERT INTO obj_parent_{s} VALUES (@x, CONCAT('p', @x), 1);\n  INSERT INTO obj_parent_{s} VALUES (@x + 100, CONCAT('p', @x + 100), 2);\nEND",
			"CREATE TRIGGER obj_trg_{s} ON obj_child_{s} AFTER INSERT AS\nBEGIN\n  SET NOCOUNT ON;\n  UPDATE c SET note = UPPER(c.note) FROM obj_child_{s} c JOIN inserted i ON i.id = c.id;\nEND",
			"CREATE SEQUENCE obj_seq_{s} START WITH 1",
		},
		use: []objectCheck{
			{sql: "EXEC dbo.obj_proc_{s} 1"},
			{sql: "INSERT INTO obj_child_{s} VALUES (1, 1, N'hello')"},
			{sql: "SELECT note FROM obj_child_{s} WHERE id = 1", want: "HELLO"},
			{sql: "SELECT dbo.obj_fn_{s}(21)", want: "42"},
			{sql: "SELECT name, note FROM obj_view_{s} WHERE id = 1", want: "p1"},
			{sql: "SELECT NEXT VALUE FOR obj_seq_{s}", want: "1"},
			{sql: "SELECT count(*) FROM obj_parent_{s} WHERE id > 0", want: "2"},
		},
		drop:    []string{"DROP VIEW obj_view_{s}", "DROP TABLE obj_child_{s}", "DROP TABLE obj_parent_{s}", "DROP FUNCTION dbo.obj_fn_{s}", "DROP PROCEDURE dbo.obj_proc_{s}", "DROP SEQUENCE obj_seq_{s}"},
		objects: []string{"obj_view_{s}", "obj_fn_{s}", "obj_proc_{s}", "obj_trg_{s}", "obj_child_note_{s}"},
	},
}

func init() {
	mariadb := objectFixtures["mysql"]
	mariadb.create = append(append([]string(nil), mariadb.create...), "CREATE SEQUENCE obj_seq_{s}")
	mariadb.use = append(append([]objectCheck(nil), mariadb.use...), objectCheck{sql: "SELECT NEXTVAL(obj_seq_{s})", want: "1"})
	mariadb.drop = append(append([]string(nil), mariadb.drop...), "DROP SEQUENCE obj_seq_{s}")
	objectFixtures["mariadb"] = mariadb
}

// TestLiveDatabaseObjects creates and uses views, functions, procedures,
// triggers, indexes, keys and sequences through the editor's query API on
// every engine, and checks that the schema browser lists them. Procedure
// and trigger bodies contain semicolons, which must not split the statement.
func TestLiveDatabaseObjects(t *testing.T) {
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
				var out map[string]any
				if json.Unmarshal(body, &out) == nil && out["error"] != nil && code == http.StatusOK {
					code = http.StatusBadGateway
				}
				return code, string(body)
			}
			t.Cleanup(func() {
				for _, statement := range fixture.drop {
					run(statement)
				}
			})
			for _, statement := range fixture.create {
				if code, body := run(statement); code != http.StatusOK {
					t.Fatalf("%s\n-> %d %.500s", named(statement), code, body)
				}
			}
			for _, check := range fixture.use {
				code, body := run(check.sql)
				if code != http.StatusOK {
					t.Errorf("%s\n-> %d %.500s", named(check.sql), code, body)
					continue
				}
				var out struct{ Rows [][]any }
				_ = json.Unmarshal([]byte(body), &out)
				if rows, _ := json.Marshal(out.Rows); check.want != "" && !strings.Contains(string(rows), check.want) {
					t.Errorf("%s: want %q in %s", named(check.sql), check.want, rows)
				}
			}
			code, _, schema := c.do(t, "GET", "/api/connections/"+connectionID+"/schema?database=rowset_e2e", nil)
			if code != http.StatusOK {
				t.Fatalf("schema: %d %.300s", code, schema)
			}
			for _, object := range fixture.objects {
				if !strings.Contains(string(schema), named(object)) {
					t.Errorf("schema browser does not list %s", named(object))
				}
			}
		})
	}
}

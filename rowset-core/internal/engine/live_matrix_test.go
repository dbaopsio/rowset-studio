package engine

import (
	"context"
	"os"
	"strconv"
	"testing"
	"time"
)

// Opt-in real-engine coverage. The release candidate job supplies the three
// passwords and ports; ordinary unit-test runs remain self-contained.
func TestLiveEngineDatatypeSyntaxAndLargeStreamMatrix(t *testing.T) {
	tests := []struct {
		name, passwordEnv, portEnv, database, username string
		port                                           int
		valueQuery, analyticQuery, largeQuery          string
		originColumn                                   string
		setup                                          []string
		minimumColumns                                 int
	}{
		{
			name: "postgres", passwordEnv: "ROWSET_MATRIX_POSTGRES_PASSWORD", portEnv: "ROWSET_MATRIX_POSTGRES_PORT", port: 55432, database: "rowset_e2e", username: "postgres", minimumColumns: 22,
			setup:      []string{`DROP TABLE IF EXISTS rowset_type_matrix`, `CREATE TABLE rowset_type_matrix (id bigint primary key, c_small smallint, c_int integer, c_big bigint, c_num numeric(20,6), c_real real, c_double double precision, c_bool boolean, c_char char(3), c_varchar varchar(40), c_text text, c_bin bytea, c_date date, c_time time, c_ts timestamp, c_tstz timestamptz, c_interval interval, c_uuid uuid, c_json json, c_jsonb jsonb, c_inet inet, c_ints integer[])`, `INSERT INTO rowset_type_matrix VALUES (1,2,3,4,12345.678901,1.25,2.5,true,'abc','Türkçe','line',decode('00ff','hex'),'2026-08-05','12:34:56','2026-08-05 12:34:56','2026-08-05 12:34:56+03','2 days','123e4567-e89b-12d3-a456-426614174000','{"a":1}','{"b":2}','127.0.0.1',ARRAY[1,2,3])`},
			valueQuery: `SELECT * FROM rowset_type_matrix WHERE id=1`, originColumn: "c_varchar",
			analyticQuery: `WITH x AS (SELECT id, c_int FROM rowset_type_matrix WHERE id=1) SELECT x.id, count(*) OVER (), sum(x.c_int) FROM x JOIN rowset_type_matrix m ON m.id=x.id GROUP BY x.id, x.c_int ORDER BY x.id`,
			largeQuery:    `SELECT g, repeat('x',64) payload FROM generate_series(1,100000) g ORDER BY g`,
		},
		{
			name: "mysql", passwordEnv: "ROWSET_MATRIX_MYSQL_PASSWORD", portEnv: "ROWSET_MATRIX_MYSQL_PORT", port: 53306, database: "rowset_e2e", username: "root", minimumColumns: 27,
			setup:      []string{`DROP TABLE IF EXISTS rowset_type_matrix`, `CREATE TABLE rowset_type_matrix (id bigint primary key, c_tiny tinyint, c_small smallint, c_medium mediumint, c_int int, c_big bigint, c_unsigned bigint unsigned, c_decimal decimal(20,6), c_float float, c_double double, c_bit bit(8), c_bool boolean, c_char char(3), c_varchar varchar(40), c_binary binary(3), c_varbinary varbinary(40), c_blob blob, c_text text, c_mediumtext mediumtext, c_longtext longtext, c_enum enum('a','b'), c_set set('x','y'), c_date date, c_time time(6), c_datetime datetime(6), c_timestamp timestamp(6), c_year year, c_json json)`, `INSERT INTO rowset_type_matrix VALUES (1,2,3,4,5,6,7,12345.678901,1.25,2.5,b'10101010',true,'abc','Türkçe',X'010203',X'00FF',X'00FF','line','medium','long','a','x,y','2026-08-05','12:34:56.123456','2026-08-05 12:34:56.123456','2026-08-05 09:34:56.123456',2026,JSON_OBJECT('a',1))`},
			valueQuery: `SELECT * FROM rowset_type_matrix WHERE id=1`, originColumn: "c_varchar",
			analyticQuery: `WITH x AS (SELECT id, c_int FROM rowset_type_matrix WHERE id=1) SELECT x.id, count(*) OVER (), sum(x.c_int) FROM x JOIN rowset_type_matrix m ON m.id=x.id GROUP BY x.id, x.c_int ORDER BY x.id`,
			largeQuery:    `SELECT ROW_NUMBER() OVER () n, repeat('x',64) payload FROM information_schema.columns a CROSS JOIN information_schema.columns b LIMIT 100000`,
		},
		{
			name: "mssql", passwordEnv: "ROWSET_MATRIX_MSSQL_PASSWORD", portEnv: "ROWSET_MATRIX_MSSQL_PORT", port: 51433, database: "rowset_e2e", username: "sa", minimumColumns: 27,
			setup:      []string{`IF OBJECT_ID('dbo.rowset_type_matrix','U') IS NOT NULL DROP TABLE dbo.rowset_type_matrix`, `CREATE TABLE dbo.rowset_type_matrix (id bigint primary key, c_bit bit, c_tiny tinyint, c_small smallint, c_int int, c_big bigint, c_decimal decimal(20,6), c_numeric numeric(20,6), c_money money, c_smallmoney smallmoney, c_float float, c_real real, c_date date, c_time time(7), c_datetime datetime, c_datetime2 datetime2(7), c_smalldt smalldatetime, c_offset datetimeoffset(7), c_char char(3), c_varchar varchar(40), c_nchar nchar(3), c_nvarchar nvarchar(40), c_binary binary(3), c_varbinary varbinary(40), c_uuid uniqueidentifier, c_xml xml, c_variant sql_variant)`, `INSERT INTO dbo.rowset_type_matrix VALUES (1,1,2,3,4,5,12345.678901,12345.678901,12.34,5.67,2.5,1.25,'2026-08-05','12:34:56.1234567','2026-08-05T12:34:56','2026-08-05T12:34:56.1234567','2026-08-05T12:34:00','2026-08-05T12:34:56.1234567+03:00','abc','text',N'şçö',N'Türkçe',0x010203,0x00FF,'123e4567-e89b-12d3-a456-426614174000','<a>1</a>',CAST(42 AS int))`},
			valueQuery: `SELECT * FROM dbo.rowset_type_matrix WHERE id=1`, originColumn: "c_nvarchar",
			analyticQuery: `WITH x AS (SELECT id, c_int FROM dbo.rowset_type_matrix WHERE id=1) SELECT x.id, count(*) OVER (), sum(x.c_int) total FROM x JOIN dbo.rowset_type_matrix m ON m.id=x.id GROUP BY x.id, x.c_int ORDER BY x.id`,
			largeQuery:    `WITH n AS (SELECT TOP (100000) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) value FROM sys.all_objects a CROSS JOIN sys.all_objects b) SELECT value, REPLICATE('x',64) payload FROM n ORDER BY value`,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			password := os.Getenv(test.passwordEnv)
			if password == "" {
				t.Skip(test.passwordEnv + " is not configured")
			}
			port := test.port
			if raw := os.Getenv(test.portEnv); raw != "" {
				if parsed, err := strconv.Atoi(raw); err == nil {
					port = parsed
				}
			}
			manager := NewManager()
			defer manager.Close()
			connection := Connection{ID: "matrix-" + test.name, Engine: test.name, Host: "127.0.0.1", Port: port, Database: test.database, Username: test.username, Password: password, PoolSize: 4}
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
			defer cancel()
			for _, statement := range test.setup {
				if _, err := manager.Execute(ctx, connection, statement, 0); err != nil {
					t.Fatalf("setup: %v", err)
				}
			}
			stream, err := manager.Query(ctx, connection, test.valueQuery)
			if err != nil {
				t.Fatal(err)
			}
			if len(stream.Columns()) < test.minimumColumns {
				t.Fatalf("got %d datatype columns, want at least %d", len(stream.Columns()), test.minimumColumns)
			}
			origins := stream.ColumnOrigins()
			if len(origins) != len(stream.Columns()) || !origins[0].Resolved || origins[0].Table != "rowset_type_matrix" || origins[0].Column != "id" {
				t.Fatalf("physical column provenance unavailable: %#v", origins)
			}
			row, ok, err := stream.Next()
			if err != nil || !ok || len(row) != len(stream.Columns()) {
				t.Fatalf("datatype row: columns=%d values=%d ok=%v err=%v", len(stream.Columns()), len(row), ok, err)
			}
			_ = stream.Close()
			expressionSQL := "SELECT " + test.originColumn + ",UPPER(" + test.originColumn + ") computed_value FROM "
			if test.name == "mssql" {
				expressionSQL += "dbo."
			}
			expressionSQL += "rowset_type_matrix WHERE id=1"
			expression, err := manager.Query(ctx, connection, expressionSQL)
			if err != nil {
				t.Fatalf("expression provenance: %v", err)
			}
			expressionOrigins := expression.ColumnOrigins()
			if len(expressionOrigins) != 2 || !expressionOrigins[0].Resolved || !expressionOrigins[1].Expression {
				t.Fatalf("direct/expression provenance mismatch: %#v", expressionOrigins)
			}
			_ = expression.Close()
			analytic, err := manager.Query(ctx, connection, test.analyticQuery)
			if err != nil {
				t.Fatalf("join/group/window/cte/order: %v", err)
			}
			if _, ok, err := analytic.Next(); err != nil || !ok {
				t.Fatalf("analytic result: ok=%v err=%v", ok, err)
			}
			_ = analytic.Close()
			large, err := manager.Query(ctx, connection, test.largeQuery)
			if err != nil {
				t.Fatalf("large stream: %v", err)
			}
			count := 0
			for {
				_, ok, err := large.Next()
				if err != nil {
					t.Fatalf("large row %d: %v", count, err)
				}
				if !ok {
					break
				}
				count++
			}
			_ = large.Close()
			if count != 100000 {
				t.Fatalf("large stream returned %d rows", count)
			}
		})
	}
}

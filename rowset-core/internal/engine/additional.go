package engine

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/ClickHouse/clickhouse-go/v2"
	"golang.org/x/crypto/ssh"
	_ "modernc.org/sqlite"
)

func FileEngine(name string) bool { return name == "sqlite" || name == "duckdb" }
func AdditionalEngine(name string) bool {
	return FileEngine(name) || name == "clickhouse" || name == "mongodb" || name == "redis" || name == "valkey" || name == "cassandra" || name == "elasticsearch"
}

// Open existing files only. A mistyped path must never silently create a DB.
func ValidateDatabaseFile(path string) error {
	if !filepath.IsAbs(path) || strings.ContainsAny(path, "?\x00") {
		return errors.New("choose an absolute path to an existing database file (without URI options)")
	}
	info, err := os.Stat(path)
	if err != nil {
		return fmt.Errorf("database file: %w", err)
	}
	if !info.Mode().IsRegular() {
		return errors.New("database path must be a regular file")
	}
	return nil
}

func openAdditional(connection Connection, tunnel *ssh.Client) (*sql.DB, error) {
	if FileEngine(connection.Engine) {
		if tunnel != nil {
			return nil, errors.New("local database files do not use SSH")
		}
		if err := ValidateDatabaseFile(connection.Database); err != nil {
			return nil, err
		}
		if connection.Engine == "duckdb" {
			return openDuckDB(connection.Database)
		}
		uri := (&url.URL{Scheme: "file", Path: connection.Database}).String()
		return sql.Open("sqlite", uri+"?mode=rw&_pragma=foreign_keys(1)&_pragma=busy_timeout(5000)")
	}
	tls, err := tlsConfig(connection.TLS, connection.Host)
	if err != nil {
		return nil, err
	}
	opts := &clickhouse.Options{Addr: []string{net.JoinHostPort(connection.Host, fmt.Sprint(connection.Port))}, Auth: clickhouse.Auth{Database: connection.Database, Username: connection.Username, Password: connection.Password}, TLS: tls, DialTimeout: 10 * time.Second, ReadTimeout: 24 * time.Hour}
	if tunnel != nil {
		opts.DialContext = func(ctx context.Context, addr string) (net.Conn, error) { return tunnelDial(ctx, tunnel, "tcp", addr) }
	}
	return clickhouse.OpenDB(opts), nil
}

func additionalSchema(ctx context.Context, db *sql.DB, connection Connection) (Schema, error) {
	result := Schema{Tables: map[string][]Column{}, Indexes: map[string][]Index{}, Views: map[string]bool{}}
	if connection.Engine == "sqlite" {
		return sqliteSchema(ctx, db, result)
	}
	query := `SELECT table_schema,table_name,column_name,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_catalog=current_database() ORDER BY table_schema,table_name,ordinal_position`
	if connection.Engine == "clickhouse" {
		query = `SELECT database,table,name,type,if(startsWith(type,'Nullable('),'YES','NO'),default_expression FROM system.columns WHERE database=currentDatabase() ORDER BY database,table,position`
	}
	rows, err := db.QueryContext(ctx, query)
	if err != nil {
		return result, err
	}
	for rows.Next() {
		var schema, table, name, kind, nullable string
		var def sql.NullString
		if err = rows.Scan(&schema, &table, &name, &kind, &nullable, &def); err != nil {
			rows.Close()
			return result, err
		}
		key := tableKey(schema, table)
		result.Tables[key] = append(result.Tables[key], Column{Schema: schema, Table: table, Name: name, DataType: kind, Nullable: nullable == "YES", Default: def.String})
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return result, err
	}
	viewQuery := `SELECT table_schema,table_name FROM information_schema.views WHERE table_catalog=current_database()`
	if connection.Engine == "clickhouse" {
		viewQuery = `SELECT database,name FROM system.tables WHERE database=currentDatabase() AND engine IN ('View','MaterializedView','LiveView','WindowView')`
	}
	views, err := db.QueryContext(ctx, viewQuery)
	if err != nil {
		return result, err
	}
	defer views.Close()
	for views.Next() {
		var schema, name string
		if err := views.Scan(&schema, &name); err != nil {
			return result, err
		}
		result.Views[tableKey(schema, name)] = true
	}
	if err := views.Err(); err != nil {
		return result, err
	}
	if connection.Engine == "duckdb" {
		if err := loadDuckDBConstraints(ctx, db, &result); err != nil {
			result.Warnings = append(result.Warnings, metadataWarning("primary-key and foreign-key", err))
		}
		if err := loadDuckDBIndexes(ctx, db, &result); err != nil {
			result.Warnings = append(result.Warnings, metadataWarning("index", err))
		}
	}
	if connection.Engine == "clickhouse" {
		// ClickHouse has no enforced foreign keys, so there's nothing missing
		// to warn about there - only primary/sorting key metadata applies.
		if err := loadClickHouseKeys(ctx, db, &result); err != nil {
			result.Warnings = append(result.Warnings, metadataWarning("primary-key", err))
		}
	}
	return result, nil
}

// loadDuckDBConstraints fills in primary keys (Column.PrimaryKey) and foreign
// keys (Column.References, as "schema.table.column") from duckdb_constraints().
func loadDuckDBConstraints(ctx context.Context, db *sql.DB, result *Schema) error {
	rows, err := db.QueryContext(ctx, `SELECT schema_name,table_name,constraint_type,constraint_column_names,referenced_table,referenced_column_names FROM duckdb_constraints() WHERE constraint_type IN ('PRIMARY KEY','FOREIGN KEY')`)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var schemaName, table, kind string
		var columnNames, refColumnNames any
		var refTable sql.NullString
		if err := rows.Scan(&schemaName, &table, &kind, &columnNames, &refTable, &refColumnNames); err != nil {
			return err
		}
		columns := duckDBStringList(columnNames)
		key := tableKey(schemaName, table)
		if kind == "PRIMARY KEY" {
			for _, name := range columns {
				for i := range result.Tables[key] {
					if result.Tables[key][i].Name == name {
						result.Tables[key][i].PrimaryKey = true
					}
				}
			}
			continue
		}
		if !refTable.Valid {
			continue
		}
		refColumns := duckDBStringList(refColumnNames)
		for i, name := range columns {
			refColumn := ""
			if i < len(refColumns) {
				refColumn = refColumns[i]
			}
			for j := range result.Tables[key] {
				if result.Tables[key][j].Name == name {
					result.Tables[key][j].References = schemaName + "." + refTable.String + "." + refColumn
				}
			}
		}
	}
	return rows.Err()
}

// loadDuckDBIndexes fills in result.Indexes from duckdb_indexes(). expressions
// comes back as a formatted string like "[col1, col2]" or "['quoted col']"
// rather than a scannable list, so it's parsed with duckDBExpressionList.
func loadDuckDBIndexes(ctx context.Context, db *sql.DB, result *Schema) error {
	rows, err := db.QueryContext(ctx, `SELECT schema_name,table_name,index_name,is_unique,is_primary,expressions FROM duckdb_indexes()`)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var schemaName, table, name, expressions string
		var unique, primary bool
		if err := rows.Scan(&schemaName, &table, &name, &unique, &primary, &expressions); err != nil {
			return err
		}
		key := tableKey(schemaName, table)
		result.Indexes[key] = append(result.Indexes[key], Index{Name: name, Columns: duckDBExpressionList(expressions), Unique: unique, Primary: primary})
	}
	return rows.Err()
}

// duckDBStringList reads a duckdb_constraints() LIST(VARCHAR) column, which
// the driver scans as []any of strings.
func duckDBStringList(value any) []string {
	items, ok := value.([]any)
	if !ok {
		return nil
	}
	result := make([]string, 0, len(items))
	for _, item := range items {
		if s, ok := item.(string); ok {
			result = append(result, s)
		}
	}
	return result
}

// duckDBExpressionList parses duckdb_indexes().expressions, a string shaped
// like a list literal - "[col1, col2]", with identifiers that need quoting
// wrapped in their own quotes, e.g. "['\"my col\"']".
func duckDBExpressionList(expressions string) []string {
	trimmed := strings.TrimSuffix(strings.TrimPrefix(strings.TrimSpace(expressions), "["), "]")
	if trimmed == "" {
		return nil
	}
	parts := strings.Split(trimmed, ", ")
	result := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.Trim(strings.TrimSpace(part), "'")
		part = strings.Trim(part, `"`)
		result = append(result, part)
	}
	return result
}

// loadClickHouseKeys marks primary-key columns (system.columns is exact per
// column) and adds one Index per table for its sorting/primary key, which is
// the closest ClickHouse concept to a traditional index.
func loadClickHouseKeys(ctx context.Context, db *sql.DB, result *Schema) error {
	rows, err := db.QueryContext(ctx, `SELECT database,table,name FROM system.columns WHERE database=currentDatabase() AND is_in_primary_key=1`)
	if err != nil {
		return err
	}
	for rows.Next() {
		var schemaName, table, name string
		if err := rows.Scan(&schemaName, &table, &name); err != nil {
			rows.Close()
			return err
		}
		key := tableKey(schemaName, table)
		for i := range result.Tables[key] {
			if result.Tables[key][i].Name == name {
				result.Tables[key][i].PrimaryKey = true
			}
		}
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()
	keyRows, err := db.QueryContext(ctx, `SELECT database,name,primary_key FROM system.tables WHERE database=currentDatabase() AND primary_key!=''`)
	if err != nil {
		return err
	}
	defer keyRows.Close()
	for keyRows.Next() {
		var schemaName, table, primaryKey string
		if err := keyRows.Scan(&schemaName, &table, &primaryKey); err != nil {
			return err
		}
		var columns []string
		for _, column := range strings.Split(primaryKey, ",") {
			if column = strings.TrimSpace(column); column != "" {
				columns = append(columns, column)
			}
		}
		if len(columns) == 0 {
			continue
		}
		key := tableKey(schemaName, table)
		result.Indexes[key] = append(result.Indexes[key], Index{Name: "primary key", Columns: columns, Unique: true, Primary: true})
	}
	return keyRows.Err()
}

func sqliteSchema(ctx context.Context, db *sql.DB, result Schema) (Schema, error) {
	rows, err := db.QueryContext(ctx, `SELECT name,type,tbl_name FROM main.sqlite_schema WHERE type IN ('table','view','trigger') AND name NOT LIKE 'sqlite_%' ORDER BY name`)
	if err != nil {
		return result, err
	}
	type object struct{ name, kind, table string }
	var objects []object
	for rows.Next() {
		var o object
		if err = rows.Scan(&o.name, &o.kind, &o.table); err != nil {
			rows.Close()
			return result, err
		}
		objects = append(objects, o)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return result, err
	}
	for _, o := range objects {
		if o.kind == "trigger" {
			result.Triggers = append(result.Triggers, Trigger{Schema: "main", Name: o.name, Table: o.table})
			continue
		}
		key := tableKey("main", o.name)
		result.Tables[key] = []Column{}
		result.Views[key] = o.kind == "view"
		cols, err := db.QueryContext(ctx, `SELECT name,type,"notnull",dflt_value,pk,hidden FROM pragma_table_xinfo(?, 'main') ORDER BY cid`, o.name)
		if err != nil {
			return result, err
		}
		for cols.Next() {
			var name, kind string
			var notnull, pk, hidden int
			var def sql.NullString
			if err = cols.Scan(&name, &kind, &notnull, &def, &pk, &hidden); err != nil {
				cols.Close()
				return result, err
			}
			generated := ""
			if hidden >= 2 {
				generated = "generated (see DDL)"
			}
			result.Tables[key] = append(result.Tables[key], Column{Schema: "main", Table: o.name, Name: name, DataType: kind, Nullable: notnull == 0, PrimaryKey: pk > 0, Default: def.String, Generated: generated})
		}
		err = cols.Err()
		cols.Close()
		if err != nil {
			return result, err
		}
		indexes, err := db.QueryContext(ctx, `SELECT name,"unique",origin FROM pragma_index_list(?, 'main') ORDER BY seq`, o.name)
		if err != nil {
			return result, err
		}
		var ix []Index
		for indexes.Next() {
			var i Index
			var origin string
			if err = indexes.Scan(&i.Name, &i.Unique, &origin); err != nil {
				indexes.Close()
				return result, err
			}
			i.Primary = origin == "pk"
			ix = append(ix, i)
		}
		err = indexes.Err()
		indexes.Close()
		if err != nil {
			return result, err
		}
		for n := range ix {
			cols, err := db.QueryContext(ctx, `SELECT COALESCE(name,'<expression>') FROM pragma_index_info(?, 'main') ORDER BY seqno`, ix[n].Name)
			if err != nil {
				return result, err
			}
			for cols.Next() {
				var name string
				if err = cols.Scan(&name); err != nil {
					cols.Close()
					return result, err
				}
				ix[n].Columns = append(ix[n].Columns, name)
			}
			err = cols.Err()
			cols.Close()
			if err != nil {
				return result, err
			}
		}
		result.Indexes[key] = ix
		fks, err := db.QueryContext(ctx, `SELECT "from","table",COALESCE("to",'') FROM pragma_foreign_key_list(?, 'main')`, o.name)
		if err != nil {
			return result, err
		}
		for fks.Next() {
			var from, table, to string
			if err = fks.Scan(&from, &table, &to); err != nil {
				fks.Close()
				return result, err
			}
			for n := range result.Tables[key] {
				if result.Tables[key][n].Name == from {
					result.Tables[key][n].References = tableKey("main", table) + "." + to
				}
			}
		}
		err = fks.Err()
		fks.Close()
		if err != nil {
			return result, err
		}
	}
	return result, nil
}

func additionalDDL(ctx context.Context, db *sql.DB, connection Connection, kind, schema, name string) (string, error) {
	var statement string
	switch connection.Engine {
	case "sqlite":
		if schema != "" && schema != "main" {
			return "", errors.New("only the main file schema is available")
		}
		err := db.QueryRowContext(ctx, `SELECT sql FROM main.sqlite_schema WHERE name=? AND type=?`, name, kind).Scan(&statement)
		return statement, err
	case "duckdb":
		query := `SELECT sql FROM duckdb_tables() WHERE database_name=current_database() AND schema_name=? AND table_name=?`
		if kind == "view" {
			query = `SELECT sql FROM duckdb_views() WHERE database_name=current_database() AND schema_name=? AND view_name=?`
		} else if kind != "table" {
			return "", errors.New("DDL is available for tables and views")
		}
		err := db.QueryRowContext(ctx, query, schema, name).Scan(&statement)
		return statement, err
	case "clickhouse":
		if kind != "table" && kind != "view" {
			return "", errors.New("DDL is available for tables and views")
		}
		err := db.QueryRowContext(ctx, "SHOW CREATE TABLE "+qualified("clickhouse", schema, name)).Scan(&statement)
		return statement, err
	}
	return "", errors.New("DDL is not supported for this engine")
}

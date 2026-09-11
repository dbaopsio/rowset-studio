package api

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/dbaopsio/rowset-studio/rowset-core/internal/domain"
	"github.com/dbaopsio/rowset-studio/rowset-core/internal/engine"
	"github.com/dbaopsio/rowset-studio/rowset-core/internal/id"
	"github.com/dbaopsio/rowset-studio/rowset-core/internal/rowlimit"
	"github.com/dbaopsio/rowset-studio/rowset-core/internal/store"
	sqlguard "github.com/dbaopsio/rowset-studio/rowset-parser"
)

// rowBackupLimit is the most rows an UPDATE or DELETE may change and still be
// backed up first.
const rowBackupLimit = 10_000

// backupTarget is the single table and WHERE clause of a simple UPDATE or
// DELETE.
type backupTarget struct {
	kind, schema, table, where string
}

// backupTargetOf recognizes UPDATE t SET … WHERE … and DELETE FROM t WHERE …
// on one table. Statements that join, use other tables or a WITH clause are
// not backed up, because the rows they change cannot be selected reliably.
func backupTargetOf(info sqlguard.Info) (backupTarget, bool) {
	if (info.Command != sqlguard.Update && info.Command != sqlguard.Delete) || len(info.Tables) != 1 || !info.HasWhere {
		return backupTarget{}, false
	}
	var top []sqlguard.Token
	for _, token := range info.Tokens {
		if token.Depth == 0 {
			top = append(top, token)
		}
	}
	if len(top) < 2 || top[0].Lower == "with" {
		return backupTarget{}, false
	}
	where, froms := -1, 0
	for index, token := range top {
		switch token.Lower {
		case "join", "using":
			return backupTarget{}, false
		case "from":
			froms++
		case "where":
			if where < 0 {
				where = index
			}
		}
	}
	if where < 0 || (info.Command == sqlguard.Update && froms > 0) || (info.Command == sqlguard.Delete && (froms != 1 || top[1].Lower != "from")) {
		return backupTarget{}, false
	}
	end := len(info.Raw)
	for _, token := range top[where+1:] {
		if token.Lower == "order" || token.Lower == "limit" || token.Lower == "returning" || token.Lower == "option" {
			end = token.Start
			break
		}
	}
	clause := strings.TrimRight(strings.TrimSpace(info.Raw[top[where].End:end]), "; \t\r\n")
	if clause == "" {
		return backupTarget{}, false
	}
	kind := "update"
	if info.Command == sqlguard.Delete {
		kind = "delete"
	}
	table := info.Tables[0]
	return backupTarget{kind: kind, schema: table.Schema, table: table.Name, where: clause}, true
}

func qualifiedTable(engineName, schema, table string) string {
	name := quoteSQLIdentifier(engineName, table)
	if schema != "" {
		name = quoteSQLIdentifier(engineName, schema) + "." + name
	}
	return name
}

// primaryKeySQL lists the primary-key columns of a table in key order.
func primaryKeySQL(engineName, schema, table string) string {
	switch strings.ToLower(engineName) {
	case "mysql", "mariadb":
		schemaSQL := "DATABASE()"
		if schema != "" {
			schemaSQL = importLiteral(engineName, schema)
		}
		return "SELECT column_name FROM information_schema.key_column_usage WHERE constraint_name = 'PRIMARY' AND table_schema = " + schemaSQL + " AND table_name = " + importLiteral(engineName, table) + " ORDER BY ordinal_position"
	case "mssql", "sqlserver":
		return "SELECT c.name FROM sys.indexes i JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id WHERE i.is_primary_key = 1 AND i.object_id = OBJECT_ID(" + importLiteral(engineName, qualifiedTable(engineName, schema, table)) + ") ORDER BY ic.key_ordinal"
	default:
		return "SELECT a.attname FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey) WHERE i.indisprimary AND i.indrelid = to_regclass(" + importLiteral(engineName, qualifiedTable(engineName, schema, table)) + ") ORDER BY array_position(i.indkey::int2[], a.attnum)"
	}
}

// readRows runs a read on the pinned transaction or a pooled connection.
func (s *Server) readRows(ctx context.Context, target engine.Connection, transaction *engine.Transaction, query string, max int) ([]string, []string, [][]any, error) {
	var stream *engine.RowStream
	var err error
	if transaction != nil {
		stream, err = transaction.Query(ctx, query)
	} else {
		stream, err = s.engines.Query(ctx, target, query)
	}
	if err != nil {
		return nil, nil, nil, err
	}
	defer stream.Close()
	var rows [][]any
	for len(rows) < max {
		row, ok, err := stream.NextRaw()
		if err != nil {
			return nil, nil, nil, err
		}
		if !ok {
			break
		}
		rows = append(rows, row)
	}
	return stream.Columns(), stream.DatabaseTypes(), rows, nil
}

// backupValue keeps a value's kind so the restore script can write it back.
type backupValue struct {
	Kind  string `json:"t"`
	Value string `json:"v,omitempty"`
}

// isBinaryType reports whether a database type holds raw bytes, which are
// written back as hex even when they happen to be valid text.
func isBinaryType(databaseType string) bool {
	databaseType = strings.ToUpper(databaseType)
	for _, kind := range []string{"BINARY", "BYTEA", "BLOB", "IMAGE", "UNIQUEIDENTIFIER", "BIT"} {
		if strings.Contains(databaseType, kind) {
			return true
		}
	}
	return false
}

func encodeBackupValue(value any, databaseType string) backupValue {
	switch v := value.(type) {
	case nil:
		return backupValue{Kind: "null"}
	case bool:
		return backupValue{Kind: "bool", Value: strconv.FormatBool(v)}
	case int64:
		return backupValue{Kind: "num", Value: strconv.FormatInt(v, 10)}
	case int32:
		return backupValue{Kind: "num", Value: strconv.FormatInt(int64(v), 10)}
	case int:
		return backupValue{Kind: "num", Value: strconv.Itoa(v)}
	case float64:
		return backupValue{Kind: "num", Value: strconv.FormatFloat(v, 'g', -1, 64)}
	case float32:
		return backupValue{Kind: "num", Value: strconv.FormatFloat(float64(v), 'g', -1, 32)}
	case time.Time:
		// Zone-aware types keep the offset; the others take the wall-clock
		// value, which every engine reads back into the same column type.
		upper := strings.ToUpper(databaseType)
		if strings.Contains(upper, "OFFSET") || strings.Contains(upper, "TIMESTAMPTZ") {
			return backupValue{Kind: "time", Value: v.Format("2006-01-02 15:04:05.999999999-07:00")}
		}
		return backupValue{Kind: "time", Value: v.Format("2006-01-02 15:04:05.999999999")}
	case []byte:
		if !isBinaryType(databaseType) && utf8.Valid(v) {
			return backupValue{Kind: "text", Value: string(v)}
		}
		return backupValue{Kind: "bytes", Value: hex.EncodeToString(v)}
	case string:
		return backupValue{Kind: "text", Value: v}
	default:
		return backupValue{Kind: "text", Value: fmt.Sprint(v)}
	}
}

func restoreLiteral(engineName string, value backupValue) string {
	engineName = strings.ToLower(engineName)
	switch value.Kind {
	case "null":
		return "NULL"
	case "bool":
		if engineName == "postgres" {
			return strings.ToUpper(value.Value)
		}
		if value.Value == "true" {
			return "1"
		}
		return "0"
	case "num":
		return value.Value
	case "bytes":
		switch engineName {
		case "mysql", "mariadb":
			return "X'" + value.Value + "'"
		case "mssql", "sqlserver":
			return "0x" + value.Value
		default:
			return `'\x` + value.Value + `'::bytea`
		}
	default:
		return importLiteral(engineName, value.Value)
	}
}

// rowBackupPayload is encrypted; the envelope binds it to its record.
type rowBackupPayload struct {
	BackupID  string          `json:"backupId"`
	UserID    string          `json:"userId"`
	Statement string          `json:"statement"`
	Columns   []string        `json:"columns"`
	Key       []string        `json:"key"`
	Rows      [][]backupValue `json:"rows"`
}

// captureRowBackup saves the rows a simple UPDATE or DELETE is about to change
// and returns response fields describing the backup, or why none was taken.
// Inside a PostgreSQL transaction the read runs under a savepoint, so a
// failed backup never aborts the caller's transaction.
func (s *Server) captureRowBackup(ctx context.Context, identity domain.Identity, connection domain.Connection, info sqlguard.Info, target engine.Connection, transaction *engine.Transaction, database string) Annotations {
	plan, ok := backupTargetOf(info)
	if !ok || s.vault == nil {
		return nil
	}
	skipped := func(reason string) Annotations { return Annotations{"backupSkipped": reason} }
	table := qualifiedTable(connection.Engine, plan.schema, plan.table)
	selectSQL := "SELECT * FROM " + table + " WHERE " + plan.where
	parsed, err := sqlguard.Parse(selectSQL)
	if err != nil {
		return skipped("the changed rows could not be selected")
	}
	limited, err := rowlimit.Apply(connection.Engine, parsed, rowBackupLimit+1)
	if err != nil {
		return skipped("the changed rows could not be selected")
	}
	savepoint := transaction != nil && connection.Engine == "postgres"
	if savepoint {
		if _, err := transaction.Execute(ctx, "SAVEPOINT rowset_backup", 0); err != nil {
			return skipped("the transaction does not allow a backup")
		}
	}
	columns, types, rows, readErr := s.readRows(ctx, target, transaction, limited, rowBackupLimit+1)
	var keyRows [][]any
	if readErr == nil {
		_, _, keyRows, readErr = s.readRows(ctx, target, transaction, primaryKeySQL(connection.Engine, plan.schema, plan.table), 64)
	}
	if savepoint {
		release := "RELEASE SAVEPOINT rowset_backup"
		if readErr != nil {
			release = "ROLLBACK TO SAVEPOINT rowset_backup"
		}
		_, _ = transaction.Execute(ctx, release, 0)
	}
	if readErr != nil {
		return skipped("the changed rows could not be read: " + readErr.Error())
	}
	if len(rows) == 0 {
		return nil
	}
	if len(rows) > rowBackupLimit {
		return skipped(fmt.Sprintf("more than %d rows would change", rowBackupLimit))
	}
	key := make([]string, 0, len(keyRows))
	for _, row := range keyRows {
		if len(row) > 0 {
			key = append(key, encodeBackupValue(row[0], "").Value)
		}
	}
	if plan.kind == "update" && len(key) == 0 {
		return skipped("the table has no primary key, so the old values could not be put back")
	}
	payload := rowBackupPayload{BackupID: id.New(), UserID: identity.UserID, Statement: info.Raw, Columns: columns, Key: key, Rows: make([][]backupValue, len(rows))}
	for index, row := range rows {
		payload.Rows[index] = make([]backupValue, len(row))
		for column, value := range row {
			databaseType := ""
			if column < len(types) {
				databaseType = types[column]
			}
			payload.Rows[index][column] = encodeBackupValue(value, databaseType)
		}
	}
	plain, err := json.Marshal(payload)
	if err != nil {
		return skipped("the backup could not be stored")
	}
	ciphertext, nonce, err := s.vault.Encrypt(plain)
	if err != nil {
		return skipped("the backup could not be stored")
	}
	item := store.RowBackup{ID: payload.BackupID, OrgID: identity.OrgID, UserID: identity.UserID, ConnectionID: connection.ID, Database: database, Schema: plan.schema, Table: plan.table, Kind: plan.kind, Rows: int64(len(rows)), Ciphertext: ciphertext, Nonce: nonce, CreatedAt: time.Now().UTC().Format(time.RFC3339Nano)}
	if err := s.store.CreateRowBackup(context.Background(), item); err != nil {
		return skipped("the backup could not be stored")
	}
	return Annotations{"backup": map[string]any{"id": item.ID, "rows": item.Rows}}
}

// discardRowBackup removes the backup of a statement that failed, since it
// changed nothing.
func (s *Server) discardRowBackup(identity domain.Identity, annotations Annotations) {
	if backup, ok := annotations["backup"].(map[string]any); ok {
		if backupID, ok := backup["id"].(string); ok {
			_ = s.store.DeleteRowBackup(context.Background(), backupID, identity.UserID)
		}
	}
}

func (s *Server) openRowBackup(item store.RowBackup) (rowBackupPayload, error) {
	var payload rowBackupPayload
	if s.vault == nil {
		return payload, errors.New("secret vault unavailable")
	}
	plain, err := s.vault.Decrypt(item.Ciphertext, item.Nonce)
	if err != nil {
		return payload, err
	}
	if err := json.Unmarshal(plain, &payload); err != nil || payload.BackupID != item.ID || payload.UserID != item.UserID {
		return payload, errors.New("the backup does not belong to this record")
	}
	return payload, nil
}

// restoreSQL returns statements that put the backed-up rows back: the old
// values for an UPDATE, the deleted rows for a DELETE.
func restoreSQL(engineName string, item store.RowBackup, payload rowBackupPayload) string {
	table := qualifiedTable(engineName, item.Schema, item.Table)
	var out strings.Builder
	fmt.Fprintf(&out, "-- Restores %d row(s) of %s backed up before this %s:\n", item.Rows, table, strings.ToUpper(item.Kind))
	for _, line := range strings.Split(strings.TrimSpace(payload.Statement), "\n") {
		out.WriteString("--   " + line + "\n")
	}
	out.WriteString("-- Review before running. In manual commit mode nothing is saved until you press Commit.\n\n")
	columns := make([]string, len(payload.Columns))
	for index, column := range payload.Columns {
		columns[index] = quoteSQLIdentifier(engineName, column)
	}
	if item.Kind == "delete" {
		for start := 0; start < len(payload.Rows); start += 100 {
			end := min(start+100, len(payload.Rows))
			out.WriteString("INSERT INTO " + table + " (" + strings.Join(columns, ", ") + ") VALUES\n")
			for index, row := range payload.Rows[start:end] {
				values := make([]string, len(row))
				for column, value := range row {
					values[column] = restoreLiteral(engineName, value)
				}
				separator := ",\n"
				if index == end-start-1 {
					separator = ";\n"
				}
				out.WriteString("  (" + strings.Join(values, ", ") + ")" + separator)
			}
		}
		return out.String()
	}
	keyIndex := map[string]bool{}
	for _, name := range payload.Key {
		keyIndex[strings.ToLower(name)] = true
	}
	for _, row := range payload.Rows {
		var assignments, conditions []string
		for column, value := range row {
			if column >= len(payload.Columns) {
				continue
			}
			name := payload.Columns[column]
			if keyIndex[strings.ToLower(name)] {
				if value.Kind == "null" {
					conditions = append(conditions, columns[column]+" IS NULL")
				} else {
					conditions = append(conditions, columns[column]+" = "+restoreLiteral(engineName, value))
				}
				continue
			}
			assignments = append(assignments, columns[column]+" = "+restoreLiteral(engineName, value))
		}
		if len(assignments) > 0 && len(conditions) > 0 {
			out.WriteString("UPDATE " + table + " SET " + strings.Join(assignments, ", ") + " WHERE " + strings.Join(conditions, " AND ") + ";\n")
		}
	}
	return out.String()
}

func (s *Server) listRowBackups(w http.ResponseWriter, r *http.Request) {
	items, err := s.store.ListRowBackups(r.Context(), identityFromContext(r.Context()).UserID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", "row backups unavailable")
		return
	}
	out := make([]map[string]any, 0, len(items))
	for _, item := range items {
		statement := ""
		if payload, err := s.openRowBackup(item); err == nil {
			statement = payload.Statement
		}
		out = append(out, map[string]any{"id": item.ID, "connectionId": item.ConnectionID, "database": item.Database, "schema": item.Schema, "table": item.Table, "kind": item.Kind, "rows": item.Rows, "statement": statement, "createdAt": item.CreatedAt})
	}
	writeJSON(w, http.StatusOK, map[string]any{"backups": out})
}

func (s *Server) rowBackupRestore(w http.ResponseWriter, r *http.Request) {
	item, err := s.store.RowBackup(r.Context(), r.PathValue("id"), identityFromContext(r.Context()).UserID)
	if err != nil {
		writeError(w, http.StatusNotFound, "NOT_FOUND", "row backup not found")
		return
	}
	payload, err := s.openRowBackup(item)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", "the backup could not be read")
		return
	}
	connection, err := s.store.Connection(r.Context(), item.ConnectionID)
	if err != nil {
		writeError(w, http.StatusNotFound, "NOT_FOUND", "the connection no longer exists")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"sql": restoreSQL(connection.Engine, item, payload), "connectionId": item.ConnectionID, "database": item.Database, "table": item.Table})
}

func (s *Server) deleteRowBackup(w http.ResponseWriter, r *http.Request) {
	if err := s.store.DeleteRowBackup(r.Context(), r.PathValue("id"), identityFromContext(r.Context()).UserID); err != nil {
		writeStoreError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

package engine

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/gocql/gocql"
)

func cassandraSession(connection Connection, keyspace string) (*gocql.Session, error) {
	cluster := gocql.NewCluster(connection.Host)
	cluster.Port = connection.Port
	cluster.Consistency = gocql.Quorum
	cluster.ConnectTimeout = 10 * time.Second
	cluster.Timeout = 24 * time.Hour
	if keyspace != "" {
		cluster.Keyspace = keyspace
	}
	if connection.Username != "" {
		cluster.Authenticator = gocql.PasswordAuthenticator{Username: connection.Username, Password: connection.Password}
	}
	if connection.TLS.Mode != TLSDisable && connection.TLS.Mode != "" {
		config, err := tlsConfig(connection.TLS, connection.Host)
		if err != nil {
			return nil, err
		}
		cluster.SslOpts = &gocql.SslOptions{Config: config}
	}
	return cluster.CreateSession()
}

func cassandraTest(ctx context.Context, connection Connection) error {
	session, err := cassandraSession(connection, "")
	if err != nil {
		return err
	}
	defer session.Close()
	return session.Query("SELECT cluster_name FROM system.local").WithContext(ctx).Exec()
}

func cassandraDatabases(ctx context.Context, connection Connection) ([]string, error) {
	session, err := cassandraSession(connection, "")
	if err != nil {
		return nil, err
	}
	defer session.Close()
	iter := session.Query("SELECT keyspace_name FROM system_schema.keyspaces").WithContext(ctx).Iter()
	var result []string
	var name string
	for iter.Scan(&name) {
		result = append(result, name)
	}
	return result, iter.Close()
}

// cassandraSchema reports each keyspace's tables and columns as one flat
// schema; Cassandra has no cross-keyspace catalog view, so every keyspace's
// tables are read and merged the way Rowset already merges schemas elsewhere.
func cassandraSchema(ctx context.Context, connection Connection) (Schema, error) {
	result := Schema{Tables: map[string][]Column{}, Indexes: map[string][]Index{}, Views: map[string]bool{}}
	keyspace := strings.TrimSpace(connection.Database)
	if keyspace == "" || keyspace == "system" {
		return result, errors.New("choose a keyspace (Database field) to browse its tables")
	}
	session, err := cassandraSession(connection, "")
	if err != nil {
		return result, err
	}
	defer session.Close()
	iter := session.Query("SELECT table_name, column_name, type, kind FROM system_schema.columns WHERE keyspace_name = ?", keyspace).WithContext(ctx).Iter()
	var table, column, kind, colKind string
	for iter.Scan(&table, &column, &kind, &colKind) {
		key := tableKey(keyspace, table)
		result.Tables[key] = append(result.Tables[key], Column{Schema: keyspace, Table: table, Name: column, DataType: kind, PrimaryKey: colKind == "partition_key" || colKind == "clustering"})
	}
	if err := iter.Close(); err != nil {
		return result, err
	}
	result.Warnings = append(result.Warnings, "Secondary indexes and materialized views are not yet loaded for Cassandra.")
	return result, nil
}

type CassandraQueryInput struct {
	Keyspace string `json:"keyspace"`
	Query    string `json:"query"`
	Limit    int    `json:"limit"`
}

// CassandraQuery runs a single read-only CQL statement (guardrail policy
// already required SELECT before this is reached) and returns rows the same
// shape as a SQL result grid.
func (m *Manager) CassandraQuery(ctx context.Context, connection Connection, input CassandraQueryInput) (Result, error) {
	if input.Limit <= 0 || input.Limit > 10000 {
		input.Limit = 1000
	}
	session, err := cassandraSession(connection, input.Keyspace)
	if err != nil {
		return Result{}, err
	}
	defer session.Close()
	started := time.Now()
	iter := session.Query(input.Query).WithContext(ctx).PageSize(input.Limit).Iter()
	columns := iter.Columns()
	names := make([]string, len(columns))
	for i, c := range columns {
		names[i] = c.Name
	}
	result := Result{Columns: names}
	row := make(map[string]any)
	for iter.MapScan(row) {
		values := make([]any, len(names))
		for i, name := range names {
			values[i] = jsonSafe(row[name])
		}
		result.Rows = append(result.Rows, values)
		row = make(map[string]any)
		if len(result.Rows) >= input.Limit {
			result.Truncated = true
			break
		}
	}
	result.DurationMS = time.Since(started).Milliseconds()
	if err := iter.Close(); err != nil && !result.Truncated {
		return result, err
	}
	return result, nil
}

// jsonSafe converts Cassandra-specific types (gocql.UUID, []byte, time.Time)
// into values the existing JSON/CSV export path already knows how to render.
func jsonSafe(v any) any {
	switch x := v.(type) {
	case gocql.UUID:
		return x.String()
	case []byte:
		raw, err := json.Marshal(x)
		if err != nil {
			return fmt.Sprintf("%x", x)
		}
		return string(raw)
	default:
		return v
	}
}

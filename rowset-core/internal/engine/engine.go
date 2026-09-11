package engine

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"database/sql/driver"
	"encoding/hex"
	"errors"
	"fmt"
	"net"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/dbaopsio/rowset-studio/rowset-core/internal/domain"
	sqlguard "github.com/dbaopsio/rowset-studio/rowset-parser"
	mysqlclient "github.com/go-mysql-org/go-mysql/client"
	gosqlmysql "github.com/go-sql-driver/mysql"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"
	mssql "github.com/microsoft/go-mssqldb"
	"github.com/microsoft/go-mssqldb/msdsn"
)

type Connection struct {
	ID                           string
	Engine, Host                 string
	Port                         int
	Database, Username, Password string
	TLS                          TLSSettings
	PoolSize                     int
}
type Result struct {
	Columns      []string `json:"columns,omitempty"`
	Rows         [][]any  `json:"rows,omitempty"`
	RowsAffected int64    `json:"rowsAffected,omitempty"`
	DurationMS   int64    `json:"durationMs"`
	Truncated    bool     `json:"truncated,omitempty"`
}

type RowStream struct {
	rows    *sql.Rows
	columns []string
	types   []string
	origins []domain.ColumnOrigin
	started time.Time
	release func() error
	closed  sync.Once
}

func (s *RowStream) Columns() []string       { return append([]string(nil), s.columns...) }
func (s *RowStream) DatabaseTypes() []string { return append([]string(nil), s.types...) }
func (s *RowStream) ColumnOrigins() []domain.ColumnOrigin {
	return append([]domain.ColumnOrigin(nil), s.origins...)
}
func (s *RowStream) DurationMS() int64 { return time.Since(s.started).Milliseconds() }
func (s *RowStream) Close() (result error) {
	s.closed.Do(func() {
		result = s.rows.Close()
		if s.release != nil {
			result = errors.Join(result, s.release())
		}
	})
	return result
}
func (s *RowStream) Next() ([]any, bool, error) {
	if !s.rows.Next() {
		return nil, false, s.rows.Err()
	}
	values := make([]any, len(s.columns))
	pointers := make([]any, len(s.columns))
	for index := range values {
		pointers[index] = &values[index]
	}
	if err := s.rows.Scan(pointers...); err != nil {
		return nil, false, err
	}
	normalizeValues(values)
	return values, true, nil
}

type Column struct {
	Schema, Table, Name, DataType string
	Nullable, PrimaryKey          bool
	References                    string
	Default, Generated, Comment   string
}
type Index struct {
	Name    string   `json:"name"`
	Columns []string `json:"columns"`
	Unique  bool     `json:"unique"`
	Primary bool     `json:"primary"`
}
type Routine struct{ Schema, Name, Kind string }
type Trigger struct{ Schema, Name, Table, Timing, Event string }
type Schema struct {
	Tables   map[string][]Column
	Indexes  map[string][]Index
	Views    map[string]bool
	Routines []Routine
	Triggers []Trigger
	Warnings []string
}

type Manager struct {
	mu    sync.Mutex
	pools map[string]*sql.DB
}

func NewManager() *Manager { return &Manager{pools: make(map[string]*sql.DB)} }
func (m *Manager) Close() error {
	m.mu.Lock()
	defer m.mu.Unlock()
	var joined error
	for key, db := range m.pools {
		joined = errors.Join(joined, db.Close())
		delete(m.pools, key)
	}
	return joined
}

// Invalidate closes every pool belonging to a saved connection. This prevents
// stale credentials and edited endpoints from accumulating until shutdown.
func (m *Manager) Invalidate(connectionID string) error {
	if connectionID == "" {
		return nil
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	var joined error
	prefix := connectionID + "|"
	for key, db := range m.pools {
		if strings.HasPrefix(key, prefix) {
			joined = errors.Join(joined, db.Close())
			delete(m.pools, key)
		}
	}
	return joined
}

func (m *Manager) Test(ctx context.Context, connection Connection) error {
	db, err := m.database(connection)
	if err != nil {
		return err
	}
	return db.PingContext(ctx)
}

func (m *Manager) Execute(ctx context.Context, connection Connection, query string, maxRows int) (Result, error) {
	started := time.Now()
	db, err := m.database(connection)
	if err != nil {
		return Result{}, err
	}
	if returnsRows(query) {
		rows, err := db.QueryContext(ctx, query)
		if err != nil {
			return Result{}, err
		}
		defer rows.Close()
		result, err := readRows(rows, maxRows)
		result.DurationMS = time.Since(started).Milliseconds()
		return result, err
	}
	execution, err := db.ExecContext(ctx, query)
	if err != nil {
		return Result{}, err
	}
	affected, _ := execution.RowsAffected()
	return Result{RowsAffected: affected, DurationMS: time.Since(started).Milliseconds()}, nil
}

func (m *Manager) Query(ctx context.Context, connection Connection, query string) (*RowStream, error) {
	started := time.Now()
	db, err := m.database(connection)
	if err != nil {
		return nil, err
	}
	conn, err := db.Conn(ctx)
	if err != nil {
		return nil, err
	}
	origins := columnOrigins(ctx, connection, conn, query)
	rows, err := conn.QueryContext(ctx, query)
	if err != nil {
		conn.Close()
		return nil, err
	}
	columns, err := rows.Columns()
	if err != nil {
		rows.Close()
		return nil, err
	}
	return newRowStream(rows, columns, origins, started, conn.Close), nil
}

type Transaction struct {
	tx      *sql.Tx
	conn    *sql.Conn
	cancel  context.CancelFunc
	finish  sync.Once
	started time.Time
}

// Session pins one physical database connection for a native wire-protocol
// client. Unlike an HTTP request, database clients expect SET state, temporary
// objects, prepared/session state, and transactions to survive across commands.
type Session struct {
	conn     *sql.Conn
	config   Connection
	tx       *sql.Tx
	lifetime context.Context
	cancel   context.CancelFunc
	closed   bool
}

func (m *Manager) OpenSession(ctx context.Context, connection Connection) (*Session, error) {
	db, err := m.database(connection)
	if err != nil {
		return nil, err
	}
	conn, err := db.Conn(ctx)
	if err != nil {
		return nil, err
	}
	lifetime, cancel := context.WithCancel(context.Background())
	return &Session{conn: conn, config: connection, lifetime: lifetime, cancel: cancel}, nil
}

func (s *Session) Begin(options TransactionOptions) error {
	if s.closed {
		return errors.New("database session is closed")
	}
	if s.tx != nil {
		return errors.New("transaction is already active")
	}
	txOptions, err := sqlTransactionOptions(options)
	if err != nil {
		return err
	}
	s.tx, err = s.conn.BeginTx(s.lifetime, txOptions)
	return err
}

func (s *Session) InTransaction() bool { return s != nil && s.tx != nil }

func (s *Session) Execute(ctx context.Context, query string, maxRows int) (Result, error) {
	if s == nil || s.closed {
		return Result{}, errors.New("database session is closed")
	}
	started := time.Now()
	if returnsRows(query) {
		var rows *sql.Rows
		var err error
		if s.tx != nil {
			rows, err = s.tx.QueryContext(ctx, query)
		} else {
			rows, err = s.conn.QueryContext(ctx, query)
		}
		if err != nil {
			return Result{}, err
		}
		defer rows.Close()
		result, err := readRows(rows, maxRows)
		result.DurationMS = time.Since(started).Milliseconds()
		return result, err
	}
	var execution sql.Result
	var err error
	if s.tx != nil {
		execution, err = s.tx.ExecContext(ctx, query)
	} else {
		execution, err = s.conn.ExecContext(ctx, query)
	}
	if err != nil {
		return Result{}, err
	}
	affected, _ := execution.RowsAffected()
	return Result{RowsAffected: affected, DurationMS: time.Since(started).Milliseconds()}, nil
}

func (s *Session) Query(ctx context.Context, query string) (*RowStream, error) {
	if s == nil || s.closed {
		return nil, errors.New("database session is closed")
	}
	started := time.Now()
	var rows *sql.Rows
	var err error
	var origins []domain.ColumnOrigin
	if s.tx != nil {
		rows, err = s.tx.QueryContext(ctx, query)
	} else {
		origins = columnOrigins(ctx, s.config, s.conn, query)
		rows, err = s.conn.QueryContext(ctx, query)
	}
	if err != nil {
		return nil, err
	}
	columns, err := rows.Columns()
	if err != nil {
		rows.Close()
		return nil, err
	}
	return newRowStream(rows, columns, origins, started, nil), nil
}

func (s *Session) Commit() error {
	if s == nil || s.tx == nil {
		return nil
	}
	err := s.tx.Commit()
	s.tx = nil
	return err
}

func (s *Session) Rollback() error {
	if s == nil || s.tx == nil {
		return nil
	}
	err := s.tx.Rollback()
	s.tx = nil
	return err
}

func (s *Session) Close() error {
	if s == nil || s.closed {
		return nil
	}
	s.closed = true
	var result error
	if s.tx != nil {
		result = s.tx.Rollback()
		s.tx = nil
	}
	s.cancel()
	return errors.Join(result, s.conn.Close())
}

func (m *Manager) Begin(ctx context.Context, connection Connection) (*Transaction, error) {
	return m.BeginWithOptions(ctx, connection, TransactionOptions{})
}

type TransactionOptions struct {
	Isolation string
	ReadOnly  bool
}

func (m *Manager) BeginWithOptions(ctx context.Context, connection Connection, options TransactionOptions) (*Transaction, error) {
	db, err := m.database(connection)
	if err != nil {
		return nil, err
	}
	// Acquire the dedicated connection with the caller's deadline, then give
	// the transaction its own lifetime. Passing the HTTP request context to
	// BeginTx would make database/sql roll the transaction back as soon as the
	// begin handler returns and cancels that request context.
	conn, err := db.Conn(ctx)
	if err != nil {
		return nil, err
	}
	lifetime, cancel := context.WithCancel(context.Background())
	txOptions, err := sqlTransactionOptions(options)
	if err != nil {
		cancel()
		_ = conn.Close()
		return nil, err
	}
	tx, err := conn.BeginTx(lifetime, txOptions)
	if err != nil {
		cancel()
		_ = conn.Close()
		return nil, err
	}
	return &Transaction{tx: tx, conn: conn, cancel: cancel, started: time.Now()}, nil
}

func sqlTransactionOptions(options TransactionOptions) (*sql.TxOptions, error) {
	isolation := strings.ToLower(strings.Join(strings.Fields(options.Isolation), " "))
	level := sql.LevelDefault
	switch isolation {
	case "", "default":
	case "read uncommitted":
		level = sql.LevelReadUncommitted
	case "read committed":
		level = sql.LevelReadCommitted
	case "repeatable read":
		level = sql.LevelRepeatableRead
	case "snapshot":
		level = sql.LevelSnapshot
	case "serializable":
		level = sql.LevelSerializable
	default:
		return nil, fmt.Errorf("unsupported transaction isolation level %q", options.Isolation)
	}
	return &sql.TxOptions{Isolation: level, ReadOnly: options.ReadOnly}, nil
}
func (t *Transaction) Execute(ctx context.Context, query string, maxRows int) (Result, error) {
	started := time.Now()
	if returnsRows(query) {
		rows, err := t.tx.QueryContext(ctx, query)
		if err != nil {
			return Result{}, err
		}
		defer rows.Close()
		result, err := readRows(rows, maxRows)
		result.DurationMS = time.Since(started).Milliseconds()
		return result, err
	}
	execution, err := t.tx.ExecContext(ctx, query)
	if err != nil {
		return Result{}, err
	}
	affected, _ := execution.RowsAffected()
	return Result{RowsAffected: affected, DurationMS: time.Since(started).Milliseconds()}, nil
}
func (t *Transaction) Query(ctx context.Context, query string) (*RowStream, error) {
	started := time.Now()
	rows, err := t.tx.QueryContext(ctx, query)
	if err != nil {
		return nil, err
	}
	columns, err := rows.Columns()
	if err != nil {
		rows.Close()
		return nil, err
	}
	return newRowStream(rows, columns, nil, started, nil), nil
}

func newRowStream(rows *sql.Rows, columns []string, origins []domain.ColumnOrigin, started time.Time, release func() error) *RowStream {
	types := make([]string, len(columns))
	if columnTypes, err := rows.ColumnTypes(); err == nil {
		for index, columnType := range columnTypes {
			if index < len(types) {
				types[index] = strings.ToUpper(columnType.DatabaseTypeName())
			}
		}
	}
	if len(origins) != len(columns) {
		origins = make([]domain.ColumnOrigin, len(columns))
	}
	return &RowStream{rows: rows, columns: columns, types: types, origins: origins, started: started, release: release}
}

func columnOrigins(ctx context.Context, connection Connection, conn *sql.Conn, query string) []domain.ColumnOrigin {
	switch strings.ToLower(connection.Engine) {
	case "mssql", "sqlserver":
		return mssqlColumnOrigins(ctx, conn, query)
	case "mysql", "mariadb":
		return mysqlColumnOrigins(ctx, connection, query)
	case "postgres", "postgresql":
	default:
		return nil
	}
	var origins []domain.ColumnOrigin
	_ = conn.Raw(func(driverConn any) error {
		pgConn, ok := driverConn.(*stdlib.Conn)
		if !ok {
			return nil
		}
		description, err := pgConn.Conn().Prepare(ctx, "", query)
		if err != nil {
			return nil
		}
		origins = make([]domain.ColumnOrigin, len(description.Fields))
		oids := make(map[uint32]struct{})
		for index, field := range description.Fields {
			if field.TableOID == 0 || field.TableAttributeNumber == 0 {
				origins[index].Expression = true
				continue
			}
			origins[index].Table = fmt.Sprint(field.TableOID)
			origins[index].Column = fmt.Sprint(field.TableAttributeNumber)
			oids[field.TableOID] = struct{}{}
		}
		if len(oids) == 0 {
			return nil
		}
		values := make([]string, 0, len(oids))
		for oid := range oids {
			values = append(values, strconv.FormatUint(uint64(oid), 10))
		}
		catalogSQL := "SELECT c.oid::text,a.attnum::text,n.nspname,c.relname,a.attname FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid WHERE c.oid IN (" + strings.Join(values, ",") + ") AND a.attnum>0 AND NOT a.attisdropped"
		rows, err := pgConn.Conn().Query(ctx, catalogSQL)
		if err != nil {
			return nil
		}
		defer rows.Close()
		resolved := make(map[string]domain.ColumnOrigin)
		for rows.Next() {
			var oid, attribute, schema, table, column string
			if err := rows.Scan(&oid, &attribute, &schema, &table, &column); err != nil {
				return nil
			}
			resolved[oid+":"+attribute] = domain.ColumnOrigin{Schema: schema, Table: table, Column: column, Resolved: true}
		}
		for index, origin := range origins {
			if value, ok := resolved[origin.Table+":"+origin.Column]; ok {
				origins[index] = value
			}
		}
		return nil
	})
	return origins
}

func mysqlColumnOrigins(ctx context.Context, connection Connection, query string) []domain.ColumnOrigin {
	address := net.JoinHostPort(connection.Host, strconv.Itoa(connection.Port))
	options := make([]mysqlclient.Option, 0, 1)
	config, err := tlsConfig(connection.TLS, connection.Host)
	if err != nil {
		return nil
	}
	if config != nil {
		options = append(options, func(conn *mysqlclient.Conn) error {
			conn.SetTLSConfig(config)
			return nil
		})
	}
	metadataConn, err := mysqlclient.ConnectWithContext(ctx, address, connection.Username, connection.Password, connection.Database, 10*time.Second, options...)
	if err != nil {
		return nil
	}
	defer metadataConn.Close()
	statement, err := metadataConn.Prepare(query)
	if err != nil {
		return nil
	}
	defer statement.Close()
	fields, err := statement.GetColumnFields()
	if err != nil {
		return nil
	}
	origins := make([]domain.ColumnOrigin, len(fields))
	for index, field := range fields {
		if len(field.OrgTable) == 0 || len(field.OrgName) == 0 {
			origins[index].Expression = true
			continue
		}
		origins[index] = domain.ColumnOrigin{Schema: string(field.Schema), Table: string(field.OrgTable), Column: string(field.OrgName), Resolved: true}
	}
	return origins
}

func mssqlColumnOrigins(ctx context.Context, conn *sql.Conn, query string) []domain.ColumnOrigin {
	const describe = `SELECT column_ordinal,source_schema,source_table,source_column
FROM sys.dm_exec_describe_first_result_set(@tsql,NULL,1)
WHERE is_hidden=0 ORDER BY column_ordinal`
	rows, err := conn.QueryContext(ctx, describe, sql.Named("tsql", query))
	if err != nil {
		return nil
	}
	defer rows.Close()
	origins := make([]domain.ColumnOrigin, 0)
	for rows.Next() {
		var ordinal int
		var schema, table, column sql.NullString
		if err := rows.Scan(&ordinal, &schema, &table, &column); err != nil || ordinal < 1 {
			return nil
		}
		for len(origins) < ordinal {
			origins = append(origins, domain.ColumnOrigin{})
		}
		if schema.Valid && table.Valid && column.Valid {
			origins[ordinal-1] = domain.ColumnOrigin{Schema: schema.String, Table: table.String, Column: column.String, Resolved: true}
		} else {
			origins[ordinal-1].Expression = true
		}
	}
	if rows.Err() != nil {
		return nil
	}
	return origins
}
func (t *Transaction) close(commit bool) error {
	var result error
	t.finish.Do(func() {
		if commit {
			result = t.tx.Commit()
		} else {
			result = t.tx.Rollback()
		}
		t.cancel()
		result = errors.Join(result, t.conn.Close())
	})
	return result
}
func (t *Transaction) Commit() error   { return t.close(true) }
func (t *Transaction) Rollback() error { return t.close(false) }

// TransactionState describes whether a manual transaction can continue.
type TransactionState string

const (
	TransactionActive TransactionState = "active"
	// TransactionAborted: PostgreSQL rejects further statements after an
	// error; only rollback is possible and commit applies nothing.
	TransactionAborted TransactionState = "aborted"
	// TransactionLost: the pinned connection is gone (statement cancel,
	// server kill, network failure). The database discards uncommitted work
	// when the session ends, so the transaction cannot be resumed.
	TransactionLost TransactionState = "lost"
)

// State inspects the pinned connection after an error. All three bundled
// drivers close the connection when a statement context is cancelled, so a
// stopped statement inside a transaction also reports TransactionLost.
func (t *Transaction) State() TransactionState {
	state := TransactionActive
	err := t.conn.Raw(func(driverConn any) error {
		if pg, ok := driverConn.(*stdlib.Conn); ok {
			if pg.Conn().IsClosed() {
				state = TransactionLost
			} else if pg.Conn().PgConn().TxStatus() == 'E' {
				state = TransactionAborted
			}
			return nil
		}
		if validator, ok := driverConn.(driver.Validator); ok && !validator.IsValid() {
			state = TransactionLost
		}
		return nil
	})
	if err != nil {
		return TransactionLost
	}
	return state
}

func readRows(rows *sql.Rows, maxRows int) (Result, error) {
	columns, err := rows.Columns()
	if err != nil {
		return Result{}, err
	}
	result := Result{Columns: columns, Rows: make([][]any, 0)}
	for rows.Next() {
		values := make([]any, len(columns))
		pointers := make([]any, len(columns))
		for index := range values {
			pointers[index] = &values[index]
		}
		if err := rows.Scan(pointers...); err != nil {
			return Result{}, err
		}
		normalizeValues(values)
		if maxRows > 0 && len(result.Rows) >= maxRows {
			result.Truncated = true
			break
		}
		result.Rows = append(result.Rows, values)
	}
	return result, rows.Err()
}

func normalizeValues(values []any) {
	for index, value := range values {
		if raw, ok := value.([]byte); ok {
			if utf8.Valid(raw) {
				values[index] = string(raw)
			} else {
				values[index] = "\\x" + hex.EncodeToString(raw)
			}
		}
	}
}

func ReturnsRows(query string) bool {
	if info, err := sqlguard.Parse(query); err == nil {
		if info.Command == sqlguard.Select {
			return true
		}
		if info.Command == sqlguard.Insert || info.Command == sqlguard.Update || info.Command == sqlguard.Delete {
			for _, token := range info.Tokens {
				if token.Depth == 0 && (token.Lower == "returning" || token.Lower == "output") {
					return true
				}
			}
			return false
		}
	}
	query = strings.TrimSpace(strings.TrimLeft(query, "(\ufeff"))
	fields := strings.Fields(query)
	if len(fields) == 0 {
		return false
	}
	switch strings.ToUpper(fields[0]) {
	case "SELECT", "WITH", "SHOW", "EXPLAIN", "DESCRIBE", "DESC", "PRAGMA", "EXEC", "EXECUTE", "VALUES":
		return true
	default:
		return strings.Contains(strings.ToUpper(query), " RETURNING ") || strings.HasSuffix(strings.ToUpper(query), " RETURNING")
	}
}

func returnsRows(query string) bool { return ReturnsRows(query) }

func (m *Manager) database(connection Connection) (*sql.DB, error) {
	key := poolKey(connection)
	m.mu.Lock()
	defer m.mu.Unlock()
	if db := m.pools[key]; db != nil {
		return db, nil
	}
	db, err := openDatabase(connection)
	if err != nil {
		return nil, err
	}
	poolSize := connection.PoolSize
	if poolSize <= 0 {
		poolSize = 10
	}
	db.SetMaxOpenConns(poolSize)
	db.SetMaxIdleConns(poolSize)
	db.SetConnMaxIdleTime(30 * time.Minute)
	db.SetConnMaxLifetime(2 * time.Hour)
	m.pools[key] = db
	return db, nil
}

// openDatabase hands every driver the same *tls.Config through a connector;
// DSN flags meant different verification guarantees on each engine.
func openDatabase(connection Connection) (*sql.DB, error) {
	config, err := tlsConfig(connection.TLS, connection.Host)
	if err != nil {
		return nil, err
	}
	_, dsn, err := connectionString(connection)
	if err != nil {
		return nil, err
	}
	switch strings.ToLower(connection.Engine) {
	case "postgres", "postgresql":
		parsed, err := pgx.ParseConfig(dsn)
		if err != nil {
			return nil, err
		}
		parsed.TLSConfig, parsed.Fallbacks = config, nil
		return stdlib.OpenDB(*parsed), nil
	case "mysql", "mariadb":
		parsed, err := gosqlmysql.ParseDSN(dsn)
		if err != nil {
			return nil, err
		}
		parsed.TLS = config
		connector, err := gosqlmysql.NewConnector(parsed)
		if err != nil {
			return nil, err
		}
		return sql.OpenDB(connector), nil
	default:
		parsed, err := msdsn.Parse(dsn)
		if err != nil {
			return nil, err
		}
		if config != nil {
			parsed.Encryption, parsed.TLSConfig, parsed.HostInCertificateProvided = msdsn.EncryptionRequired, config, true
		}
		return sql.OpenDB(mssql.NewConnectorConfig(parsed)), nil
	}
}

// connectionString returns a plaintext DSN; openDatabase layers TLS on top.
func connectionString(connection Connection) (string, string, error) {
	hostPort := net.JoinHostPort(connection.Host, fmt.Sprint(connection.Port))
	switch strings.ToLower(connection.Engine) {
	case "postgres", "postgresql":
		u := &url.URL{Scheme: "postgres", User: url.UserPassword(connection.Username, connection.Password), Host: hostPort, Path: "/" + connection.Database}
		q := u.Query()
		q.Set("sslmode", "disable")
		u.RawQuery = q.Encode()
		return "pgx", u.String(), nil
	case "mysql", "mariadb":
		cfg := gosqlmysql.NewConfig()
		cfg.User = connection.Username
		cfg.Passwd = connection.Password
		cfg.Net = "tcp"
		cfg.Addr = hostPort
		cfg.DBName = connection.Database
		cfg.ParseTime = true
		cfg.Timeout = 10 * time.Second
		cfg.ReadTimeout = 24 * time.Hour
		cfg.WriteTimeout = 24 * time.Hour
		return "mysql", cfg.FormatDSN(), nil
	case "mssql", "sqlserver":
		u := &url.URL{Scheme: "sqlserver", User: url.UserPassword(connection.Username, connection.Password), Host: hostPort}
		q := u.Query()
		q.Set("database", connection.Database)
		q.Set("encrypt", "disable")
		u.RawQuery = q.Encode()
		return "sqlserver", u.String(), nil
	default:
		return "", "", fmt.Errorf("unsupported engine: %s", connection.Engine)
	}
}

func poolKey(connection Connection) string {
	digest := sha256.Sum256([]byte(connection.Password))
	return fmt.Sprintf("%s|%s:%s:%d/%s/%s/%x/%s/%d", connection.ID, connection.Engine, connection.Host, connection.Port, connection.Database, connection.Username, digest[:8], connection.TLS.digest(), connection.PoolSize)
}

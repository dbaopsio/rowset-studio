CREATE TABLE schema_snapshots (
    connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
    database_name TEXT NOT NULL,
    payload BLOB NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (connection_id, database_name)
);

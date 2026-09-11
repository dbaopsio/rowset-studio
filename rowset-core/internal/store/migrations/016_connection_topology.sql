CREATE TABLE IF NOT EXISTS connection_nodes (
    id TEXT PRIMARY KEY,
    connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    host TEXT NOT NULL,
    port INTEGER NOT NULL CHECK(port BETWEEN 1 AND 65535),
    detected_role TEXT NOT NULL DEFAULT 'unknown'
        CHECK(detected_role IN ('primary', 'secondary', 'unknown')),
    health TEXT NOT NULL DEFAULT 'unknown'
        CHECK(health IN ('healthy', 'unreachable', 'unknown')),
    read_only INTEGER NOT NULL DEFAULT 1,
    last_checked_at TEXT,
    last_error TEXT,
    created_at TEXT NOT NULL,
    UNIQUE(connection_id, name),
    UNIQUE(connection_id, host, port)
);

CREATE INDEX IF NOT EXISTS idx_connection_nodes_connection
    ON connection_nodes(connection_id);
CREATE INDEX IF NOT EXISTS idx_connection_nodes_routing
    ON connection_nodes(connection_id, health, detected_role);

-- Every pre-topology connection remains usable and becomes the first node.
INSERT OR IGNORE INTO connection_nodes(
    id, connection_id, name, host, port, detected_role, health, read_only, created_at
)
SELECT 'legacy-' || id, id, 'node-1', host, port, 'unknown', 'unknown', 1, created_at
FROM connections;

ALTER TABLE role_connection_access ADD COLUMN node_policy TEXT NOT NULL DEFAULT 'user_selectable'
    CHECK(node_policy IN ('primary_only', 'secondary_only', 'user_selectable'));
ALTER TABLE role_connection_access ADD COLUMN default_node_role TEXT NOT NULL DEFAULT 'primary'
    CHECK(default_node_role IN ('primary', 'secondary'));

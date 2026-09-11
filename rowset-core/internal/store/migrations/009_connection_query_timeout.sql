ALTER TABLE connections ADD COLUMN query_timeout_seconds INTEGER NOT NULL DEFAULT 600;

-- Explicit TLS verification settings. tls_required stays in sync for older
-- readers. Existing rows, and rows restored from older backups (empty mode),
-- keep their previous behavior: PostgreSQL and SQL Server encrypted without
-- verifying the server; MySQL verified it.
ALTER TABLE connections ADD COLUMN tls_mode TEXT NOT NULL DEFAULT '';
ALTER TABLE connections ADD COLUMN tls_server_name TEXT NOT NULL DEFAULT '';
ALTER TABLE connections ADD COLUMN tls_ca_pem TEXT NOT NULL DEFAULT '';
ALTER TABLE connections ADD COLUMN tls_client_cert_pem TEXT NOT NULL DEFAULT '';
ALTER TABLE connections ADD COLUMN tls_client_key_secret_id TEXT NOT NULL DEFAULT '';
UPDATE connections SET tls_mode = CASE
  WHEN tls_required = 0 THEN 'disable'
  WHEN lower(engine) IN ('mysql', 'mariadb') THEN 'verify-full'
  ELSE 'require'
END;

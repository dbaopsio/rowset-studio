ALTER TABLE connections ADD COLUMN ssh_host TEXT NOT NULL DEFAULT '';
ALTER TABLE connections ADD COLUMN ssh_port INTEGER NOT NULL DEFAULT 0;
ALTER TABLE connections ADD COLUMN ssh_user TEXT NOT NULL DEFAULT '';
ALTER TABLE connections ADD COLUMN ssh_auth_method TEXT NOT NULL DEFAULT '';
ALTER TABLE connections ADD COLUMN ssh_known_host TEXT NOT NULL DEFAULT '';
ALTER TABLE connections ADD COLUMN ssh_secret_id TEXT NOT NULL DEFAULT '';
ALTER TABLE connections ADD COLUMN ssh_passphrase_secret_id TEXT NOT NULL DEFAULT '';

package config

import (
	"bytes"
	"encoding/base64"
	"testing"
)

func TestPersonalDefaultsAndBoundary(t *testing.T) {
	t.Setenv("ROWSET_JWT_SECRET", "a-production-secret-that-is-long-enough")
	t.Setenv("ROWSET_ENC_KEY", base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{9}, 32)))
	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Shared || cfg.DBPath != "rowset-community.sqlite3" {
		t.Fatal("incorrect personal defaults")
	}
	cfg.BindHost = "0.0.0.0"
	if cfg.Validate() == nil {
		t.Fatal("public personal bind accepted")
	}
}

func TestLoadValidatesProductionSecrets(t *testing.T) {
	t.Setenv("ROWSET_ENV", "production")
	t.Setenv("ROWSET_JWT_SECRET", "a-production-secret-that-is-long-enough")
	t.Setenv("ROWSET_ENC_KEY", base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{9}, 32)))
	t.Setenv("ROWSET_BOOTSTRAP_ADMIN_PASSWORD", "a-secure-bootstrap-password")
	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Environment != Production || !cfg.SecureCookies || cfg.DBPath != "rowset-community.sqlite3" {
		t.Fatalf("unexpected config: %#v", cfg)
	}
}

func TestRejectsDefaultSecrets(t *testing.T) {
	t.Setenv("ROWSET_ENV", "development")
	t.Setenv("ROWSET_JWT_SECRET", "dev-only-change-me")
	t.Setenv("ROWSET_ENC_KEY", base64.StdEncoding.EncodeToString(defaultEncryptionKey))
	if _, err := Load(); err == nil {
		t.Fatal("weak defaults accepted")
	}
}

func TestLoadsEnginePoolSizes(t *testing.T) {
	t.Setenv("ROWSET_ENV", "production")
	t.Setenv("ROWSET_JWT_SECRET", "a-production-secret-that-is-long-enough")
	t.Setenv("ROWSET_ENC_KEY", base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{8}, 32)))
	t.Setenv("ROWSET_POSTGRES_POOL_SIZE", "17")
	t.Setenv("ROWSET_MYSQL_POOL_SIZE", "19")
	t.Setenv("ROWSET_MSSQL_POOL_SIZE", "23")
	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.PostgresPoolSize != 17 || cfg.MySQLPoolSize != 19 || cfg.MSSQLPoolSize != 23 {
		t.Fatalf("pool sizes were not loaded: %#v", cfg)
	}
}

func TestRejectsUnboundedPoolSize(t *testing.T) {
	t.Setenv("ROWSET_ENV", "production")
	t.Setenv("ROWSET_JWT_SECRET", "a-production-secret-that-is-long-enough")
	t.Setenv("ROWSET_ENC_KEY", base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{8}, 32)))
	t.Setenv("ROWSET_MYSQL_POOL_SIZE", "1001")
	if _, err := Load(); err == nil {
		t.Fatal("unbounded pool size accepted")
	}
}

package engine

import (
	"context"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestApplyKeyMetadataAcrossNonDefaultSchemas(t *testing.T) {
	schema := Schema{Tables: map[string][]Column{
		"apm.ApmProvider": {{Schema: "apm", Table: "ApmProvider", Name: "Id"}, {Schema: "apm", Table: "ApmProvider", Name: "CategoryId"}},
	}}
	applyPrimaryKeys(&schema, map[string]bool{"apm.ApmProvider.Id": true})
	applyForeignKeys(&schema, map[string]string{"apm.ApmProvider.CategoryId": "apm.ApmProviderCategory.Id"})

	columns := schema.Tables["apm.ApmProvider"]
	if !columns[0].PrimaryKey {
		t.Fatal("non-default schema primary key was not applied")
	}
	if columns[1].References != "apm.ApmProviderCategory.Id" {
		t.Fatalf("non-default schema foreign key=%q", columns[1].References)
	}
}

func TestLiveMSSQLSchemaDiscoveryOnCaseSensitiveCatalog(t *testing.T) {
	password := os.Getenv("ROWSET_MATRIX_MSSQL_PASSWORD")
	if password == "" {
		t.Skip("ROWSET_MATRIX_MSSQL_PASSWORD is not configured")
	}
	port := 51433
	if raw := os.Getenv("ROWSET_MATRIX_MSSQL_PORT"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil {
			t.Fatal(err)
		}
		port = parsed
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	admin := NewManager()
	defer admin.Close()
	master := Connection{ID: "schema-cs-admin", Engine: "mssql", Host: "127.0.0.1", Port: port, Database: "master", Username: "sa", Password: password, PoolSize: 1}
	const databaseName = "rowset_schema_cs"
	_, _ = admin.Execute(ctx, master, "IF DB_ID('"+databaseName+"') IS NOT NULL BEGIN ALTER DATABASE "+databaseName+" SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE "+databaseName+"; END", 0)
	if _, err := admin.Execute(ctx, master, "CREATE DATABASE "+databaseName+" COLLATE Latin1_General_100_CS_AS", 0); err != nil {
		t.Fatal(err)
	}
	defer func() {
		_, _ = admin.Execute(context.Background(), master, "ALTER DATABASE "+databaseName+" SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE "+databaseName, 0)
	}()

	targetManager := NewManager()
	target := Connection{ID: "schema-cs-target", Engine: "mssql", Host: "127.0.0.1", Port: port, Database: databaseName, Username: "sa", Password: password, PoolSize: 1}
	for _, statement := range []string{
		"CREATE SCHEMA apm",
		"CREATE TABLE apm.CaseProbe (Id int NOT NULL PRIMARY KEY, DisplayName nvarchar(80) NULL)",
		"CREATE VIEW apm.CaseProbeView AS SELECT Id,DisplayName FROM apm.CaseProbe",
	} {
		if _, err := targetManager.Execute(ctx, target, statement, 0); err != nil {
			t.Fatal(err)
		}
	}
	discovered, err := targetManager.Schema(ctx, target)
	_ = targetManager.Close()
	if err != nil {
		t.Fatal(err)
	}
	columns := discovered.Tables["apm.CaseProbe"]
	if len(columns) != 2 || !columns[0].PrimaryKey || !discovered.Views["apm.CaseProbeView"] {
		t.Fatalf("case-sensitive schema discovery=%#v", discovered)
	}
}

func TestMSSQLCoreSchemaDiscoveryUsesNativeCatalogs(t *testing.T) {
	query, err := schemaColumnsQuery("mssql")
	if err != nil {
		t.Fatal(err)
	}
	lower := strings.ToLower(query)
	if strings.Contains(lower, "information_schema") || !strings.Contains(lower, "sys.columns") || !strings.Contains(lower, "sys.schemas") || !strings.Contains(lower, "sys.types") {
		t.Fatalf("unexpected MSSQL schema query: %s", query)
	}
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatSql, splitStatements, statementAt, sqlTokens } from './sqlText.ts';

test('format preserves every quoted token and comment', () => {
  const sql = " SELECT 'a  b, WHERE c', \"Case Name\", $$begin;  end$$ FROM t -- keep  this\n WHERE x='it''s  safe' /* nested /* text */ remains */;";
  const protectedTokens = (s) => sqlTokens(s).filter(t => ['quoted','comment'].includes(t.kind)).map(t => t.text);
  assert.deepEqual(protectedTokens(formatSql(sql)), protectedTokens(sql));
  assert.equal(formatSql("SELECT 'a  b';"), "SELECT 'a  b';");
  assert.match(formatSql('SELECT 1; -- comment\nSELECT 2;'), /-- comment\nSELECT 2/);
});
test('split ignores semicolons in strings, dollar bodies, identifiers and comments', () => {
  const sql = "SELECT ';', $$;$$, [a;b]; -- ;\nSELECT 2;";
  assert.equal(splitStatements(sql).length, 2);
  assert.equal(statementAt(sql, 4), "SELECT ';', $$;$$, [a;b];");
  assert.match(statementAt(sql, sql.length), /SELECT 2/);
});

test("routine bodies are not split at their semicolons", () => {
  const mysql = "CREATE PROCEDURE p(IN x INT)\nBEGIN\n  IF x > 0 THEN\n    INSERT INTO t VALUES (x);\n  END IF;\n  SELECT CASE WHEN x > 1 THEN 'a' ELSE 'b' END;\nEND;\nSELECT 1;";
  assert.deepEqual(splitStatements(mysql).map((s) => s.sql), [mysql.slice(0, mysql.indexOf("\nSELECT 1;")), "SELECT 1;"]);
  const mssql = "CREATE OR ALTER TRIGGER tr ON t AFTER INSERT AS\nBEGIN\n  BEGIN TRANSACTION;\n  UPDATE t SET a = 1;\n  COMMIT;\nEND;\nSELECT 2";
  assert.equal(splitStatements(mssql).length, 2);
  assert.equal(splitStatements("SELECT 1; SELECT 2").length, 2);
});

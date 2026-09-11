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

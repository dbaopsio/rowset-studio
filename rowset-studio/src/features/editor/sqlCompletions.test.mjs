import assert from "node:assert/strict";
import test from "node:test";
import { aliasMap, buildSqlCompletions, dotSuggestions } from "./sqlCompletions.ts";

const schema = buildSqlCompletions({ schemas: [{ name: "Public", tables: [{ name: "Users", columns: [{ name: "id", dataType: "int", nullable: false }, { name: "email", dataType: "text", nullable: false }] }], views: [], routines: [], triggers: [] }] });

test("schema and qualified table names feed completion", () => {
  assert.deepEqual(dotSuggestions("select Public.", "public", schema), { kind: "table", values: ["Users"] });
  assert.deepEqual(dotSuggestions("select u. from Public.Users as u", "u", schema), { kind: "column", values: ["id", "email"], owner: "Public.Users" });
});

test("aliases do not consume SQL clause keywords", () => {
  const aliases = aliasMap("select users. from Public.Users WHERE id = 1");
  assert.equal(aliases.users, "public.users");
  assert.equal(aliases.where, undefined);
});

test('database names are offered where a statement can reach them', () => {
  const schema = { schemas: [{ name: 'dbo', tables: [{ name: 'orders', columns: [{ name: 'id' }] }] }] };
  const mssql = buildSqlCompletions(schema, ['rowset_e2e', 'master'], 'sqlserver');
  assert.deepEqual(Object.values(mssql.databaseNames), ['rowset_e2e', 'master']);
  assert.deepEqual(dotSuggestions('select * from rowset_e2e.', 'rowset_e2e', mssql), { kind: 'schema', values: ['dbo'] });
  assert.deepEqual(buildSqlCompletions(schema, ['other'], 'postgres').databaseNames, {});
});

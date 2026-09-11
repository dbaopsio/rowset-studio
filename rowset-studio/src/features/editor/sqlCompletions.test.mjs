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

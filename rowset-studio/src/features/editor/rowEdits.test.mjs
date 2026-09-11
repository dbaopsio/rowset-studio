import assert from "node:assert/strict";
import test from "node:test";
import { editTarget, sqlLiteral, updateStatements } from "./rowEdits.ts";

const origins = [
  { schema: "public", table: "customers", column: "id" },
  { schema: "public", table: "customers", column: "name" },
  null,
];
const pk = (schema, table) => (schema === "public" && table === "customers" ? ["id"] : null);

test("a result is editable only from one table with its whole key", () => {
  assert.deepEqual(editTarget(origins, pk)?.key, [0]);
  assert.equal(editTarget([origins[1], null], pk), null, "key column missing");
  assert.equal(editTarget([...origins, { schema: "public", table: "orders", column: "id" }], pk), null, "two tables");
  assert.equal(editTarget([{ schema: "public", table: "logs", column: "id" }], pk), null, "no primary key");
  assert.equal(editTarget(undefined, pk), null);
});

test("builds one UPDATE per changed row with quoted names and literals", () => {
  const target = editTarget(origins, pk);
  const statements = updateStatements("postgres", target, [
    { row: [7, "Ann", 1], values: new Map([[1, "O'Brien"]]) },
    { row: [8, "Bob", 2], values: new Map([[1, null], [0, "99"]]) },
  ]);
  assert.deepEqual(statements, [
    `UPDATE "public"."customers" SET "name" = 'O''Brien' WHERE "id" = 7`,
    `UPDATE "public"."customers" SET "name" = NULL WHERE "id" = 8`,
  ]);
});

test("literals follow each engine's rules", () => {
  assert.equal(sqlLiteral("mysql", "a\\b'c"), "'a\\\\b''c'");
  assert.equal(sqlLiteral("mssql", "Ş"), "N'Ş'");
  assert.equal(sqlLiteral("postgres", true), "TRUE");
  assert.equal(sqlLiteral("mariadb", false), "0");
  const target = { schema: "sales", table: "orders", columns: ["id", "total"], key: [0] };
  assert.deepEqual(updateStatements("mssql", target, [{ row: ["A1", 5], values: new Map([[1, "6"]]) }]), ["UPDATE [sales].[orders] SET [total] = N'6' WHERE [id] = N'A1'"]);
  assert.deepEqual(updateStatements("mysql", target, [{ row: [1, 5], values: new Map([[1, "6"]]) }]), ["UPDATE `sales`.`orders` SET `total` = '6' WHERE `id` = 1"]);
});

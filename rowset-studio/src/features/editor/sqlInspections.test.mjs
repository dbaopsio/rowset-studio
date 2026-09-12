import test from "node:test";
import assert from "node:assert/strict";
import { buildSqlCompletions } from "./sqlCompletions.ts";
import { inspectSql } from "./sqlInspections.ts";

const column = (name) => ({ name, dataType: "int", nullable: true });
const schema = (engine, schemaName = "public") => buildSqlCompletions({
  schemas: [{
    name: schemaName,
    tables: [
      { name: "orders", columns: ["id", "customer_id", "total", "status", "created_at"].map(column) },
      { name: "customers", columns: ["id", "name", "email", "status"].map(column) },
      { name: "order_items", columns: ["id", "order_id", "sku"].map(column) },
    ],
    views: [{ name: "recent_orders", columns: ["id", "total"].map(column) }],
  }, {
    name: "billing",
    tables: [{ name: "orders", columns: ["id", "amount"].map(column) }],
  }],
}, ["otherdb"], engine);

const pg = schema("postgres");
const codes = (sql, completions = pg) => inspectSql(sql, completions).map((item) => `${item.code}:${sql.slice(item.start, item.end)}`);

test("reads that are correct raise nothing", () => {
  for (const sql of [
    "SELECT id, total FROM orders WHERE status = 'paid'",
    "SELECT o.id, c.name FROM orders o JOIN customers c ON c.id = o.customer_id",
    // The subquery's id belongs to the subquery, not to the outer query.
    "SELECT id FROM orders WHERE customer_id IN (SELECT id FROM customers)",
    "SELECT o.id AS id FROM orders o JOIN customers c ON c.id = o.customer_id ORDER BY id",
    "SELECT EXTRACT(year FROM created_at) FROM orders",
    "SELECT * FROM orders WHERE total IS DISTINCT FROM 0",
    "SELECT * FROM orders FOR UPDATE SKIP LOCKED",
    "WITH recent AS (SELECT * FROM orders) SELECT * FROM recent",
    "SELECT * FROM generate_series(1, 3) g",
    "SELECT * FROM pg_class",
    "SELECT * FROM information_schema.tables",
    "SELECT * FROM billing.orders",
    "SELECT * FROM recent_orders",
    "SELECT id FROM orders JOIN customers USING (id)",
    "CREATE TABLE scratch (a int); SELECT a FROM scratch",
    "SELECT o.* FROM orders o",
    "SELECT 'it''s (not' AS text, \"quoted name\" FROM orders",
    "INSERT INTO orders (id, total) VALUES (1, 2)",
    "UPDATE orders SET total = 0 WHERE id = 1",
    "DELETE FROM orders WHERE id = 1",
  ]) assert.deepEqual(codes(sql), [], sql);
});

test("unknown tables and columns are reported with close names to change to", () => {
  const [table] = inspectSql("SELECT * FROM ordrs", pg);
  assert.equal(table.code, "unknown-table");
  assert.deepEqual(table.fixes.map((fix) => fix.replacement), ["orders"]);

  const [qualified] = inspectSql("SELECT * FROM public.custmers", pg);
  assert.equal(qualified.code, "unknown-table");
  assert.deepEqual(qualified.fixes.map((fix) => fix.replacement), ["customers"]);

  const [col] = inspectSql("SELECT o.totl FROM orders o", pg);
  assert.equal(col.code, "unknown-column");
  assert.equal(col.message, "orders has no column totl.");
  assert.deepEqual(col.fixes.map((fix) => fix.replacement), ["total"]);

  // Quoting is kept when a quoted name is corrected.
  const [quoted] = inspectSql('SELECT "o"."totl" FROM orders "o"', pg);
  assert.deepEqual(quoted.fixes.map((fix) => fix.replacement), ['"total"']);

  // A name that cannot be checked is left alone.
  assert.deepEqual(codes("SELECT * FROM otherdb.orders", schema("mysql")), []);
  assert.deepEqual(codes("SELECT * FROM sysobjects", schema("mssql", "dbo")), []);
  assert.deepEqual(codes("SELECT x.anything FROM (SELECT 1 AS a) x"), []);
});

test("a column two tables share must be qualified, with a fix for each", () => {
  const [item] = inspectSql("SELECT id FROM orders o JOIN customers c ON c.id = o.customer_id", pg);
  assert.equal(item.code, "ambiguous-column");
  assert.deepEqual(item.fixes.map((fix) => fix.replacement), ["o.id", "c.id"]);
  assert.deepEqual(codes("SELECT o.id FROM public.orders o JOIN customers c ON c.id = o.customer_id WHERE status = 'x'"), ["ambiguous-column:status"]);
  // Unqualified, orders may be public.orders or billing.orders depending on
  // the search path, and billing.orders has no status: nothing is certain.
  assert.deepEqual(codes("SELECT o.id FROM orders o JOIN customers c ON c.id = o.customer_id WHERE status = 'x'"), []);
});

test("broken strings, comments and brackets are errors", () => {
  assert.deepEqual(codes("SELECT 'abc FROM orders"), ["unterminated:'"]);
  assert.deepEqual(codes('SELECT "abc FROM orders'), ['unterminated:"']);
  assert.deepEqual(codes("SELECT 1 /* note"), ["unterminated:/*"]);
  assert.deepEqual(codes("SELECT $$ body"), ["unterminated:$$"]);
  assert.deepEqual(codes("SELECT (1 + 2 FROM orders"), ["unbalanced:("]);
  assert.deepEqual(codes("SELECT 1 + 2) FROM orders"), ["unbalanced:)"]);
  // "#" is a comment only on MySQL and MariaDB.
  assert.deepEqual(codes("SELECT * FROM (SELECT * FROM #t) x", schema("mssql", "dbo")), []);
  assert.deepEqual(codes("SELECT data #> '{a}' FROM orders WHERE (id = 1)"), []);
  assert.deepEqual(codes("SELECT 1 # a comment (", schema("mysql")), []);
});

test("UPDATE and DELETE without WHERE are warned about", () => {
  assert.deepEqual(codes("DELETE FROM orders"), ["no-where:DELETE"]);
  assert.deepEqual(codes("update orders set total = 0"), ["no-where:update"]);
  // A WHERE inside a subquery does not limit the statement itself.
  assert.deepEqual(codes("DELETE FROM orders WHERE id IN (SELECT order_id FROM order_items)"), []);
  assert.deepEqual(codes("UPDATE orders SET total = (SELECT 1 FROM customers WHERE id = 1)"), ["no-where:UPDATE"]);
  // Nothing about names is checked before the schema has loaded.
  assert.deepEqual(codes("SELECT * FROM anything_at_all", buildSqlCompletions(undefined, [], "postgres")), []);
});

test("positions are right in the second of several statements", () => {
  const sql = "SELECT 1;\n\n  SELECT o.totl FROM orders o;";
  const [item] = inspectSql(sql, pg);
  assert.equal(sql.slice(item.start, item.end), "totl");
});

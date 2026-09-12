import test from "node:test";
import { setTimeout, clearTimeout } from "node:timers";
import assert from "node:assert/strict";
import { combineResults, runOnConnections, scriptChanges, statementEffect } from "./multiRun.ts";

test("reads are recognised and everything else counts as a change", () => {
  for (const sql of [
    "SELECT * FROM orders",
    "  -- comment\n select 1",
    "SHOW TABLES",
    "DESCRIBE orders",
    "EXPLAIN SELECT * FROM orders",
    "WITH recent AS (SELECT * FROM orders WHERE id > 10) SELECT * FROM recent",
    "WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x < 5) SELECT x FROM n",
    "SELECT 'delete from orders' AS note",
    "VALUES (1), (2)",
  ]) assert.equal(statementEffect(sql), "read", sql);

  for (const sql of [
    "UPDATE orders SET total = 0 WHERE id = 1",
    "DELETE FROM orders",
    "INSERT INTO orders VALUES (1)",
    "CREATE INDEX i ON orders(id)",
    "DROP TABLE orders",
    "TRUNCATE orders",
    "EXEC dbo.cleanup",
    "CALL cleanup()",
    "SET search_path TO app",
    // The CTE only reads; the statement itself deletes.
    "WITH old AS (SELECT id FROM orders WHERE total = 0) DELETE FROM orders WHERE id IN (SELECT id FROM old)",
    // EXPLAIN ANALYZE runs what it measures.
    "EXPLAIN ANALYZE DELETE FROM orders",
    "SELECT * INTO orders_copy FROM orders",
    "MERGE INTO t USING s ON t.id = s.id WHEN MATCHED THEN DELETE",
    "",
  ]) assert.equal(statementEffect(sql), "change", sql);

  assert.equal(scriptChanges(["SELECT 1", "SELECT 2"]), false);
  assert.equal(scriptChanges(["SELECT 1", "DELETE FROM t"]), true);
});

const targets = ["a", "b", "c", "d", "e"].map((name) => ({ connectionId: name, name, engine: "postgres", environment: "dev", database: "app" }));
const result = (columns, rows) => ({ columns, rows, rowCount: rows.length, durationMs: 1 });

test("connections run side by side, statements in order, and an error stops only its connection", async () => {
  let running = 0, peak = 0;
  const seen = [];
  const outcomes = await runOnConnections(targets, ["SELECT 1", "SELECT 2", "SELECT 3"], async (target, sql) => {
    running++; peak = Math.max(peak, running);
    await new Promise((resolve) => setTimeout(resolve, 5));
    running--;
    seen.push(`${target.name}:${sql}`);
    if (target.name === "b" && sql === "SELECT 2") throw new Error("relation does not exist");
    return result(["n"], [[sql]]);
  }, { concurrency: 2, signal: new globalThis.AbortController().signal });

  assert.ok(peak <= 2, `ran ${peak} at once`);
  const byName = Object.fromEntries(outcomes.map((outcome) => [outcome.target.name, outcome]));
  assert.equal(byName.b.status, "error");
  assert.equal(byName.b.completed, 1);
  assert.equal(byName.b.failedStatement, "SELECT 2");
  assert.ok(!seen.includes("b:SELECT 3"), "a statement ran after its connection failed");
  for (const name of ["a", "c", "d", "e"]) {
    assert.equal(byName[name].status, "success", name);
    assert.equal(byName[name].completed, 3);
    assert.deepEqual(byName[name].result.rows, [["SELECT 3"]]);
  }
  // Within one connection the order is kept.
  assert.deepEqual(seen.filter((item) => item.startsWith("a:")), ["a:SELECT 1", "a:SELECT 2", "a:SELECT 3"]);
});

test("stopping cancels what is running and everything still queued", async () => {
  const controller = new globalThis.AbortController();
  const outcomes = await runOnConnections(targets, ["SELECT 1"], (target, _sql, signal) => new Promise((resolve, reject) => {
    if (target.name === "a") { controller.abort(); }
    const timer = setTimeout(() => resolve(result(["n"], [[1]])), 50);
    signal.addEventListener("abort", () => { clearTimeout(timer); reject(new Error("aborted")); });
    if (signal.aborted) { clearTimeout(timer); reject(new Error("aborted")); }
  }), { concurrency: 1, signal: controller.signal });
  assert.deepEqual(outcomes.map((outcome) => outcome.status), ["cancelled", "cancelled", "cancelled", "cancelled", "cancelled"]);
  assert.match(outcomes[0].error, /may have completed/);
});

test("results with the same columns are combined with the connection in front", () => {
  const done = (name, rows, columns = ["id", "total"]) => ({ target: { ...targets[0], name }, status: "success", completed: 1, total: 1, result: { ...result(columns, rows), columnTypes: ["INT", "NUMERIC"] } });
  const combined = combineResults([done("east", [[1, 10]]), done("west", [[2, 20], [3, 30]]), { target: targets[2], status: "error", completed: 0, total: 1, error: "x" }]);
  assert.deepEqual(combined.columns, ["connection", "id", "total"]);
  assert.deepEqual(combined.rows, [["east", 1, 10], ["west", 2, 20], ["west", 3, 30]]);
  assert.deepEqual(combined.columnTypes, ["TEXT", "INT", "NUMERIC"]);
  assert.equal(combined.rowCount, 3);
  assert.equal(combineResults([done("east", [[1, 10]]), done("west", [[1]], ["id"])]), null);
  assert.equal(combineResults([done("east", [[1, 10]])]), null);
});

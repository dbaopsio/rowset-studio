import test from "node:test";
import assert from "node:assert/strict";
import { applyEvent, combineResults, failOutcomes, initialOutcomes, scriptChanges, statementEffect, stopOutcomes } from "./multiRun.ts";

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

test("progress events from the server become each connection's outcome", () => {
  let outcomes = initialOutcomes(targets.slice(0, 3), 2);
  assert.deepEqual(outcomes.map((outcome) => outcome.status), ["queued", "queued", "queued"]);
  outcomes = applyEvent(outcomes, { type: "target", index: 1, status: "running", completed: 0, total: 2, durationMs: 0 }, 1000);
  outcomes = applyEvent(outcomes, { type: "target", index: 1, status: "running", completed: 1, total: 2, rowCount: 3, durationMs: 40 }, 1040);
  outcomes = applyEvent(outcomes, { type: "target", index: 1, status: "success", completed: 2, total: 2, rowCount: 1, durationMs: 90, result: result(["n"], [[7]]) }, 1090);
  outcomes = applyEvent(outcomes, { type: "target", index: 2, status: "error", completed: 0, total: 2, error: "relation does not exist", failedStatement: "SELECT x", durationMs: 5 }, 1100);
  // Events for a connection that is not in the run, and the closing event, change nothing.
  outcomes = applyEvent(outcomes, { type: "target", index: 9, status: "success", completed: 2, total: 2, durationMs: 1 });
  outcomes = applyEvent(outcomes, { type: "done", index: 0, completed: 0, total: 2, durationMs: 0 });

  assert.equal(outcomes[0].status, "queued");
  assert.deepEqual({ status: outcomes[1].status, completed: outcomes[1].completed, rowCount: outcomes[1].rowCount, durationMs: outcomes[1].durationMs, startedAt: outcomes[1].startedAt, endedAt: outcomes[1].endedAt },
    { status: "success", completed: 2, rowCount: 1, durationMs: 90, startedAt: 1000, endedAt: 1090 });
  assert.deepEqual(outcomes[1].result.rows, [[7]]);
  assert.equal(outcomes[2].error, "relation does not exist");
  assert.equal(outcomes[2].failedStatement, "SELECT x");
});

test("stopping or losing the run settles every connection still going", () => {
  let outcomes = initialOutcomes(targets.slice(0, 3), 1);
  outcomes = applyEvent(outcomes, { type: "target", index: 0, status: "success", completed: 1, total: 1, durationMs: 5 });
  outcomes = applyEvent(outcomes, { type: "target", index: 1, status: "running", completed: 0, total: 1, durationMs: 0 });
  const stopped = stopOutcomes(outcomes);
  assert.deepEqual(stopped.map((outcome) => outcome.status), ["success", "cancelled", "cancelled"]);
  assert.match(stopped[1].error, /may have completed/);
  const failed = failOutcomes(outcomes, "network error");
  assert.deepEqual(failed.map((outcome) => outcome.status), ["success", "error", "error"]);
  assert.equal(failed[2].error, "network error");
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

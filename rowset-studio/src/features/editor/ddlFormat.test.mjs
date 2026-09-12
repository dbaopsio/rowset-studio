import test from "node:test";
import assert from "node:assert/strict";
import { formatDefinition } from "./ddlFormat.ts";
import { sqlTokens } from "./sqlText.ts";

// Definitions exactly as the four databases returned them.
test("a MySQL trigger reads on lines", () => {
  assert.equal(
    formatDefinition("CREATE DEFINER=`root`@`%` TRIGGER `obj_trg_demo` BEFORE INSERT ON `obj_child_demo` FOR EACH ROW SET NEW.note = UPPER(NEW.note)", "mysql"),
    "CREATE DEFINER=`root`@`%` TRIGGER `obj_trg_demo`\nBEFORE INSERT ON `obj_child_demo`\nFOR EACH ROW\nSET NEW.note = UPPER(NEW.note)",
  );
});

test("a PostgreSQL trigger reads on lines", () => {
  assert.equal(
    formatDefinition("CREATE TRIGGER obj_trg_demo BEFORE INSERT ON obj_child_demo FOR EACH ROW EXECUTE FUNCTION obj_trg_fn_demo()", "postgres"),
    "CREATE TRIGGER obj_trg_demo\nBEFORE INSERT ON obj_child_demo\nFOR EACH ROW\nEXECUTE FUNCTION obj_trg_fn_demo()",
  );
});

test("a MySQL view puts its columns and FROM on their own lines", () => {
  assert.equal(
    formatDefinition("CREATE ALGORITHM=UNDEFINED DEFINER=`root`@`%` SQL SECURITY DEFINER VIEW `obj_view_demo` AS select `c`.`id` AS `id`,`p`.`name` AS `name`,`c`.`note` AS `note` from (`obj_child_demo` `c` join `obj_parent_demo` `p` on((`p`.`id` = `c`.`parent_id`)))", "mysql"),
    "CREATE ALGORITHM=UNDEFINED DEFINER=`root`@`%` SQL SECURITY DEFINER VIEW `obj_view_demo` AS\nselect `c`.`id` AS `id`,\n       `p`.`name` AS `name`,\n       `c`.`note` AS `note`\nfrom (`obj_child_demo` `c` join `obj_parent_demo` `p` on((`p`.`id` = `c`.`parent_id`)))",
  );
});

test("a SQL Server view and function read on lines", () => {
  assert.equal(
    formatDefinition("CREATE VIEW obj_view_demo AS SELECT c.id, p.name, c.note FROM obj_child_demo c JOIN obj_parent_demo p ON p.id = c.parent_id", "mssql"),
    "CREATE VIEW obj_view_demo AS\nSELECT c.id,\n       p.name,\n       c.note\nFROM obj_child_demo c\nJOIN obj_parent_demo p ON p.id = c.parent_id",
  );
  assert.equal(
    formatDefinition("CREATE FUNCTION dbo.obj_fn_demo(@x int) RETURNS int AS BEGIN RETURN @x * 2 END", "mssql"),
    "CREATE FUNCTION dbo.obj_fn_demo(@x int) RETURNS int AS\nBEGIN\n  RETURN @x * 2\nEND",
  );
});

test("left and outer joins break once, before the join", () => {
  assert.equal(
    formatDefinition("CREATE VIEW v AS SELECT a.id FROM a LEFT OUTER JOIN b ON b.id = a.id WHERE a.id > 0 ORDER BY a.id", "postgres"),
    "CREATE VIEW v AS\nSELECT a.id\nFROM a\nLEFT OUTER JOIN b ON b.id = a.id\nWHERE a.id > 0\nORDER BY a.id",
  );
});

test("a definition written on lines, and every string, is left as it is", () => {
  const written = "CREATE PROCEDURE dbo.obj_proc_demo @x int AS\nBEGIN\n  INSERT INTO t VALUES (@x);\nEND";
  assert.equal(formatDefinition(written, "mssql"), written);
  const withString = formatDefinition("CREATE VIEW v AS SELECT 'from, where;  begin' AS note, x FROM t", "postgres");
  assert.ok(withString.includes("'from, where;  begin'"), withString);
  assert.equal(withString, "CREATE VIEW v AS\nSELECT 'from, where;  begin' AS note,\n       x\nFROM t");
});

test("formatting changes whitespace between tokens and nothing else", () => {
  const samples = [
    ["mysql", "CREATE DEFINER=`root`@`%` TRIGGER `obj_trg_demo` BEFORE INSERT ON `obj_child_demo` FOR EACH ROW SET NEW.note = UPPER(NEW.note)"],
    ["mariadb", "CREATE ALGORITHM=UNDEFINED DEFINER=`root`@`%` SQL SECURITY DEFINER VIEW `obj_view_demo` AS select `c`.`id` AS `id`,`p`.`name` AS `name`,`c`.`note` AS `note` from (`obj_child_demo` `c` join `obj_parent_demo` `p` on(`p`.`id` = `c`.`parent_id`))"],
    ["mssql", "CREATE FUNCTION dbo.obj_fn_demo(@x int) RETURNS int AS BEGIN RETURN @x * 2 END"],
    ["mssql", "CREATE VIEW obj_view_demo AS SELECT c.id, p.name, c.note FROM obj_child_demo c JOIN obj_parent_demo p ON p.id = c.parent_id"],
    ["postgres", "CREATE TRIGGER t BEFORE UPDATE ON orders FOR EACH ROW WHEN (OLD.total IS DISTINCT FROM NEW.total) EXECUTE FUNCTION audit('x, y;  z')"],
    ["mysql", "CREATE TRIGGER t BEFORE INSERT ON orders FOR EACH ROW BEGIN SET NEW.a = 1; SET NEW.b = CONCAT('begin ', 'end;'); END"],
  ];
  for (const [engine, sql] of samples) {
    const formatted = formatDefinition(sql, engine);
    const shape = (text) => sqlTokens(text, { hashComments: engine === "mysql" || engine === "mariadb" }).filter((token) => token.kind !== "space").map((token) => token.text);
    assert.deepEqual(shape(formatted), shape(sql), formatted);
    assert.ok(formatted.includes("\n"), `nothing was laid out for: ${sql}`);
  }
});

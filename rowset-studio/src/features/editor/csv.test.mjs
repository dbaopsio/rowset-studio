import assert from "node:assert/strict";
import test from "node:test";
import { detectDelimiter, parseCsv } from "./csv.ts";

test("parses quotes, embedded delimiters and line breaks", () => {
  const text = '﻿id,name,note\r\n1,"Ayşe, Y.","line1\nline2"\n2,Bob,\n3,"say ""hi""",x\n';
  assert.deepEqual(parseCsv(text, ","), [
    ["id", "name", "note"],
    ["1", "Ayşe, Y.", "line1\nline2"],
    ["2", "Bob", ""],
    ["3", 'say "hi"', "x"],
  ]);
});

test("stops after maxRows and keeps a stray quote as text", () => {
  assert.deepEqual(parseCsv('a,b\n5" screen,x\nc,d\n', ",", 2), [["a", "b"], ['5" screen', "x"]]);
  assert.deepEqual(parseCsv("x;y", ";"), [["x", "y"]]);
});

test("detects the delimiter from the first line", () => {
  assert.equal(detectDelimiter("id;name;city\n1;a;b"), ";");
  assert.equal(detectDelimiter("id\tname\n1\ta"), "\t");
  assert.equal(detectDelimiter('"a,b"|c|d\n'), "|");
  assert.equal(detectDelimiter("single\n"), ",");
});

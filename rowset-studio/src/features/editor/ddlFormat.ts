import { sqlTokens } from "./sqlText.ts";

// Databases hand some definitions back on a single line — a MySQL trigger or
// view, a PostgreSQL trigger, a SQL Server view — which reads badly in a
// dialog. Those are laid out on lines here. A definition that already has
// lines is shown exactly as its author wrote it. Only whitespace between
// tokens changes: strings, quoted names and comments are kept byte for byte,
// and the case of every word is left alone.

const SELECT_BREAKS = new Set(["from", "where", "group", "having", "order", "limit", "union", "intersect", "except", "window"]);
const JOIN_STARTS = new Set(["join", "left", "right", "inner", "full", "cross", "natural"]);

export function formatDefinition(sql: string, engine = ""): string {
  const text = sql.trim();
  if (!text || text.includes("\n")) return sql;
  const all = sqlTokens(text, { hashComments: engine === "mysql" || engine === "mariadb" });
  const tokens = all.filter((token) => token.kind !== "space");
  const words = tokens.map((token) => (token.kind === "word" ? token.text.toLowerCase() : ""));
  const isTrigger = words.slice(0, 8).includes("trigger");

  // Decisions are made per token: start a new line before it, or after it.
  // A break only ever replaces the whitespace already there, or adds a line
  // where there was none; nothing else about the text changes.
  const before = new Map<number, number>();
  const after = new Map<number, number>();
  let indent = 0;
  let parens = 0;
  let inSelect = false;
  let clause = "";
  let headerDone = false;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const lower = words[i];
    const atTop = parens === 0 && token.text !== "(";
    if (atTop && lower) {
      if (isTrigger && !headerDone && words[i - 2] === "trigger") { before.set(i, 0); headerDone = true; }
      else if (isTrigger && lower === "for" && words[i + 1] === "each") before.set(i, 0);
      else if (isTrigger && ["when", "execute", "referencing"].includes(lower) && clause !== "block") before.set(i, 0);
      if (isTrigger && words[i - 1] === "row" && words[i - 2] === "each" && lower !== "begin") before.set(i, 0);

      if (lower === "begin" && !["tran", "transaction", "work", "distributed"].includes(words[i + 1] ?? "")) {
        before.set(i, indent);
        indent += 2;
        after.set(i, indent);
        clause = "block";
      } else if (lower === "end" && indent > 0 && !["if", "loop", "while", "repeat", "case"].includes(words[i + 1] ?? "")) {
        indent -= 2;
        before.set(i, indent);
      } else if (lower === "select") {
        if (words[i - 1] === "as") before.set(i, indent);
        inSelect = true;
        clause = "select";
      } else if (inSelect && SELECT_BREAKS.has(lower)) {
        before.set(i, indent);
        clause = lower;
      } else if (inSelect && JOIN_STARTS.has(lower) && !JOIN_STARTS.has(words[i - 1] ?? "") && words[i - 1] !== "outer") {
        before.set(i, indent);
      }
    }
    if (token.text === "(") parens++;
    else if (token.text === ")") parens = Math.max(0, parens - 1);
    else if (parens === 0) {
      if (token.text === "," && clause === "select") after.set(i, indent + "select ".length);
      if (token.text === ";" && clause === "block") after.set(i, indent);
    }
  }

  let out = "";
  let pending: number | undefined;
  let space = "";
  let index = -1;
  for (const token of all) {
    if (token.kind === "space") { space = token.text; continue; }
    index++;
    const lineStart = before.get(index) ?? pending;
    if (lineStart !== undefined && out) out = out.trimEnd() + "\n" + " ".repeat(lineStart);
    else out += space;
    out += token.text;
    space = "";
    pending = after.get(index);
  }
  return out;
}

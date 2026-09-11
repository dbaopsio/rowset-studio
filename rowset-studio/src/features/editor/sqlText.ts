// Lexical utilities preserve quoted identifiers, strings, dollar bodies and
// comments byte-for-byte. They never format by replacing inside SQL literals.
export interface SQLToken { text: string; start: number; end: number; kind: "space" | "comment" | "quoted" | "word" | "symbol" }

export function sqlTokens(sql: string): SQLToken[] {
  const tokens: SQLToken[] = [];
  let i = 0;
  while (i < sql.length) {
    const start = i;
    let kind: SQLToken["kind"] = "symbol";
    if (/\s/.test(sql[i])) {
      kind = "space"; while (i < sql.length && /\s/.test(sql[i])) i++;
    } else if (sql.startsWith("--", i) || sql[i] === "#") {
      kind = "comment"; while (i < sql.length && sql[i] !== "\n") i++;
      if (i < sql.length) i++;
    } else if (sql.startsWith("/*", i)) {
      kind = "comment"; i += 2; let depth = 1;
      while (i < sql.length && depth) {
        if (sql.startsWith("/*", i)) { depth++; i += 2; }
        else if (sql.startsWith("*/", i)) { depth--; i += 2; }
        else i++;
      }
    } else if (["'", '"', "`", "["].includes(sql[i])) {
      kind = "quoted";
      const open = sql[i++], close = open === "[" ? "]" : open;
      while (i < sql.length) {
        if (sql[i] === close) {
          i++;
          if (sql[i] === close) { i++; continue; }
          break;
        }
        if (sql[i] === "\\" && open !== "[") i++;
        i++;
      }
      i = Math.min(i, sql.length);
    } else if (sql[i] === "$" && /^\$(?:[A-Za-z_][\w]*)?\$/.test(sql.slice(i))) {
      kind = "quoted";
      const delimiter = sql.slice(i).match(/^\$(?:[A-Za-z_][\w]*)?\$/)![0];
      const end = sql.indexOf(delimiter, i + delimiter.length);
      i = end < 0 ? sql.length : end + delimiter.length;
    } else if (/[\w$]/.test(sql[i])) {
      kind = "word"; while (i < sql.length && /[\w$]/.test(sql[i])) i++;
    } else i++;
    tokens.push({ text: sql.slice(start, i), start, end: i, kind });
  }
  return tokens;
}

export function formatSql(sql: string): string {
  const tokens = sqlTokens(sql);
  let out = "", space = false, depth = 0;
  const breaks = new Set(["FROM", "WHERE", "HAVING", "LIMIT", "OFFSET", "RETURNING", "JOIN", "SET", "VALUES", "UNION"]);
  for (const token of tokens) {
    if (token.kind === "space") { space = true; continue; }
    if (token.kind === "symbol" && token.text === ")") depth--;
    if (token.kind === "word" && depth === 0 && breaks.has(token.text.toUpperCase()) && out) out = out.trimEnd() + "\n";
    else if (space && out && !/\s$/.test(out)) out += " ";
    out += token.text;
    if (token.kind === "comment" && (token.text.startsWith("--") || token.text.startsWith("#")) && !out.endsWith("\n")) out += "\n";
    if (token.kind === "symbol" && token.text === "(") depth++;
    space = false;
  }
  return out.trim();
}

export function splitStatements(sql: string): { sql: string; start: number; end: number }[] {
  const result: { sql: string; start: number; end: number }[] = [];
  let start = 0;
  const add = (end: number) => {
    const part = sql.slice(start, end);
    if (sqlTokens(part).some((t) => t.kind !== "space" && t.kind !== "comment" && t.text !== ";")) result.push({ sql: part.trim(), start, end });
    start = end;
  };
  for (const t of sqlTokens(sql)) if (t.kind === "symbol" && t.text === ";") add(t.end);
  add(sql.length);
  return result;
}

export function statementAt(sql: string, offset: number): string {
  const statements = splitStatements(sql);
  return (statements.find((s) => offset >= s.start && offset < s.end) ?? statements.at(-1))?.sql ?? "";
}

import { splitStatements, sqlTokens, type SQLToken } from "./sqlText.ts";
import type { SqlCompletions } from "./sqlCompletions";

// Problems found while typing, from the text and the schema already loaded —
// no parser and no round trip to the database. Every check prefers saying
// nothing to saying something wrong: a name that cannot be verified (another
// database, a system catalogue, a CTE, a table created earlier in the script)
// is left alone.

export type InspectionCode = "unterminated" | "unbalanced" | "unknown-table" | "unknown-column" | "ambiguous-column" | "no-where";

export interface InspectionFix {
  title: string;
  /** Text to put in place of start..end. */
  replacement: string;
  start: number;
  end: number;
}

export interface Inspection {
  start: number;
  end: number;
  severity: "error" | "warning";
  code: InspectionCode;
  message: string;
  fixes: InspectionFix[];
}

// Typing in a very large script should stay responsive; hints for it are
// skipped rather than computed on every keystroke.
const INSPECT_LIMIT = 512 * 1024;

const HASH_COMMENT_ENGINES = new Set(["mysql", "mariadb"]);

// Words that are never a column or alias where they appear.
const RESERVED = new Set([
  "select", "from", "where", "and", "or", "not", "null", "is", "in", "like", "ilike", "between", "exists", "case", "when",
  "then", "else", "end", "as", "on", "join", "inner", "left", "right", "full", "outer", "cross", "natural", "group", "by",
  "order", "having", "limit", "offset", "fetch", "next", "rows", "row", "only", "distinct", "all", "union", "intersect",
  "except", "insert", "into", "values", "update", "set", "delete", "with", "recursive", "asc", "desc", "nulls", "first",
  "last", "true", "false", "interval", "date", "time", "timestamp", "year", "month", "day", "hour", "minute", "second",
  "zone", "at", "over", "partition", "window", "range", "preceding", "following", "current", "unbounded", "cast",
  "convert", "top", "percent", "collate", "escape", "any", "some", "similar", "returning", "using", "lateral", "filter",
  "within", "for", "of", "nowait", "skip", "locked", "share", "key", "default", "tablesample", "pivot", "unpivot",
  "apply", "straight_join", "use", "force", "ignore", "index", "option", "go", "exec", "execute", "call", "top",
]);

const COLUMN_CLAUSES = new Set(["select", "where", "on", "group", "order", "having"]);

interface TableRef {
  scope: number;
  /** Lower-case, unquoted parts of the name. */
  parts: string[];
  /** Token of the last part, the table name itself. */
  token: SQLToken;
  alias?: string;
  keyword: "from" | "join" | "update" | "insert";
}

export function inspectSql(sql: string, completions?: SqlCompletions): Inspection[] {
  if (!sql.trim() || sql.length > INSPECT_LIMIT) return [];
  const engine = completions?.engine ?? "";
  const hashComments = !engine || HASH_COMMENT_ENGINES.has(engine);
  const schemaLoaded = Boolean(completions && Object.keys(completions.schemaTables).length > 0);
  const statements = splitStatements(sql, engine).map((statement) => {
    const tokens = sqlTokens(sql.slice(statement.start, statement.end), { hashComments }).map((token) => ({ ...token, start: token.start + statement.start, end: token.end + statement.start }));
    return { tokens, meaningful: tokens.filter((token) => token.kind !== "space" && token.kind !== "comment" && token.text !== ";") };
  });
  const created = createdNames(statements.map((statement) => statement.meaningful));
  const out: Inspection[] = [];
  for (const { tokens, meaningful } of statements) {
    const syntax = balance(tokens, meaningful);
    out.push(...syntax);
    if (syntax.length || !meaningful.length) continue;
    const verb = mainVerb(meaningful);
    out.push(...missingWhere(meaningful, verb));
    if (!schemaLoaded || !completions || isRoutine(meaningful)) continue;
    if (verb.word !== "select" && verb.word !== "insert" && verb.word !== "update" && verb.word !== "delete") continue;
    out.push(...names(meaningful, verb, completions, created));
  }
  return out.sort((a, b) => a.start - b.start);
}

// ---- Unterminated strings, identifiers and comments; unbalanced brackets ----

function balance(tokens: SQLToken[], meaningful: SQLToken[]): Inspection[] {
  const out: Inspection[] = [];
  for (const token of tokens) {
    const problem = unterminated(token);
    if (problem) out.push({ start: token.start, end: token.start + Math.min(token.text.length, problem.width), severity: "error", code: "unterminated", message: problem.message, fixes: [] });
  }
  // An unterminated string swallows the rest of the statement, brackets and
  // all, so counting them would only add noise.
  if (out.length) return out;
  const open: SQLToken[] = [];
  for (const token of meaningful) {
    if (token.kind !== "symbol") continue;
    if (token.text === "(") open.push(token);
    else if (token.text === ")") {
      if (open.length) open.pop();
      else out.push({ start: token.start, end: token.end, severity: "error", code: "unbalanced", message: "This ) closes nothing.", fixes: [] });
    }
  }
  for (const token of open) out.push({ start: token.start, end: token.end, severity: "error", code: "unbalanced", message: "This ( is never closed.", fixes: [] });
  return out;
}

function unterminated(token: SQLToken): { message: string; width: number } | null {
  const text = token.text;
  if (token.kind === "comment" && text.startsWith("/*")) {
    let depth = 0;
    for (let i = 0; i < text.length; ) {
      if (text.startsWith("/*", i)) { depth++; i += 2; }
      else if (text.startsWith("*/", i)) { depth--; i += 2; }
      else i++;
    }
    return depth > 0 ? { message: "This comment is never closed.", width: 2 } : null;
  }
  if (token.kind !== "quoted") return null;
  if (text.startsWith("$")) {
    const delimiter = text.match(/^\$(?:[A-Za-z_]\w*)?\$/)?.[0] ?? "$$";
    return text.length >= delimiter.length * 2 && text.endsWith(delimiter) ? null : { message: `This ${delimiter} string is never closed.`, width: delimiter.length };
  }
  const open = text[0];
  const close = open === "[" ? "]" : open;
  let i = 1;
  while (i < text.length) {
    if (text[i] === close) {
      i++;
      if (text[i] === close) { i++; continue; }
      return null;
    }
    if (text[i] === "\\" && open !== "[") i++;
    i++;
  }
  return { message: open === "'" ? "This string is never closed." : "This quoted name is never closed.", width: 1 };
}

// ---- UPDATE and DELETE that reach every row ----

function missingWhere(meaningful: SQLToken[], verb: { word: string; index: number }): Inspection[] {
  if (verb.word !== "update" && verb.word !== "delete") return [];
  let depth = 0;
  for (const token of meaningful) {
    if (token.text === "(") depth++;
    else if (token.text === ")") depth--;
    else if (depth === 0 && token.kind === "word" && token.text.toLowerCase() === "where") return [];
  }
  const token = meaningful[verb.index];
  return [{
    start: token.start,
    end: token.end,
    severity: "warning",
    code: "no-where",
    message: verb.word === "update" ? "UPDATE without WHERE changes every row of the table." : "DELETE without WHERE removes every row of the table.",
    fixes: [],
  }];
}

// ---- Tables and columns checked against the loaded schema ----

function names(m: SQLToken[], verb: { word: string; index: number }, completions: SqlCompletions, created: Set<string>): Inspection[] {
  const engine = completions.engine ?? "";
  // Scopes: each subquery gets its own, and brackets that are not a subquery
  // (function calls, lists) stay in the scope around them.
  const scopeOf: number[] = [];
  const depthOf: number[] = [];
  const scopeDepth: number[] = [0];
  const clause: string[] = [];
  const scopeClause: string[] = ["other"];
  const noAmbiguity = new Set<number>();
  const stack: { scope: number }[] = [];
  let scope = 0;
  let depth = 0;
  for (let i = 0; i < m.length; i++) {
    const token = m[i];
    if (token.text === "(") {
      const next = word(m[i + 1]);
      stack.push({ scope });
      depth++;
      if (next === "select" || next === "with") {
        scope = scopeDepth.length;
        scopeDepth.push(depth);
        scopeClause.push("other");
      }
      scopeOf[i] = stack[stack.length - 1].scope;
      depthOf[i] = depth - 1;
      clause[i] = scopeClause[scopeOf[i]];
      continue;
    }
    if (token.text === ")") {
      const popped = stack.pop();
      depth = Math.max(0, depth - 1);
      if (popped) scope = popped.scope;
    }
    scopeOf[i] = scope;
    depthOf[i] = depth;
    const lower = word(token);
    if (lower && depth === scopeDepth[scope]) {
      if (lower === "join") scopeClause[scope] = "from";
      else if (["select", "from", "where", "on", "group", "order", "having", "set", "values", "into", "returning", "limit", "offset", "window", "fetch", "union", "intersect", "except", "using"].includes(lower)) scopeClause[scope] = lower;
      if (lower === "using" || lower === "natural") noAmbiguity.add(scope);
    }
    clause[i] = scopeClause[scope];
  }

  const ctes = cteNames(m);
  const refs: TableRef[] = [];
  const tableTokens = new Set<SQLToken>();
  for (let i = 0; i < m.length; i++) {
    const lower = word(m[i]);
    if (!lower || depthOf[i] !== scopeDepth[scopeOf[i]]) continue;
    let keyword: TableRef["keyword"] | null = null;
    if (lower === "from" || lower === "join") {
      // IS [NOT] DISTINCT FROM compares two values.
      if (lower === "from" && word(m[i - 1]) === "distinct") continue;
      keyword = lower;
    } else if (lower === "update" && i === verb.index) keyword = "update";
    else if (lower === "into" && verb.word === "insert") keyword = "insert";
    else if (m[i].text === "," && scopeClause[scopeOf[i]] === "from") keyword = "from";
    if (m[i].text === "," && clause[i] === "from") keyword = "from";
    if (!keyword) continue;
    let j = i + 1;
    while (["only", "lateral", "low_priority", "ignore"].includes(word(m[j]) ?? "")) j++;
    if (word(m[j]) === "top" || !isIdentifier(m[j])) continue;
    const parts: SQLToken[] = [m[j]];
    while (m[j + 1]?.text === "." && isIdentifier(m[j + 2])) { j += 2; parts.push(m[j]); }
    // A function in FROM is not a table; INSERT INTO t (columns) is.
    if (m[j + 1]?.text === "(" && keyword !== "insert") continue;
    parts.forEach((part) => tableTokens.add(part));
    let alias: string | undefined;
    const after = m[j + 1];
    if (word(after) === "as" && isIdentifier(m[j + 2])) alias = unquote(m[j + 2].text);
    else if (isIdentifier(after) && !RESERVED.has(word(after) ?? "")) alias = unquote(after.text);
    refs.push({ scope: scopeOf[i], parts: parts.map((part) => unquote(part.text)), token: parts[parts.length - 1], alias, keyword });
  }

  const out: Inspection[] = [];
  const tablesByName = new Map<string, string[]>();
  for (const [schema, tables] of Object.entries(completions.schemaTables)) {
    for (const table of tables) {
      const key = table.toLowerCase();
      tablesByName.set(key, [...(tablesByName.get(key) ?? []), `${schema}.${key}`]);
    }
  }
  const resolve = (ref: TableRef): string[] | null => {
    const table = ref.parts[ref.parts.length - 1];
    if (ref.parts.length === 1) return tablesByName.get(table) ?? [];
    if (ref.parts.length === 2) {
      const schema = ref.parts[0];
      if (!completions.schemaNames[schema]) return null;
      return (completions.schemaTables[schema] ?? []).some((name) => name.toLowerCase() === table) ? [`${schema}.${table}`] : [];
    }
    return null;
  };

  // Unknown tables.
  for (const ref of refs) {
    const table = ref.parts[ref.parts.length - 1];
    if (ctes.has(table) || created.has(table) || ref.token.text.startsWith("#")) continue;
    if (ref.parts.length === 1 && ((engine === "postgres" && table.startsWith("pg_")) || (engine === "mssql" && table.startsWith("sys")) || table === "dual")) continue;
    const keys = resolve(ref);
    if (!keys || keys.length) continue;
    const pool = ref.parts.length === 2 ? completions.schemaTables[ref.parts[0]] ?? [] : [...new Set(Object.values(completions.schemaTables).flat())];
    out.push({
      start: ref.token.start,
      end: ref.token.end,
      severity: "warning",
      code: "unknown-table",
      message: `${ref.parts.join(".")} is not a table or view in the schema Rowset has loaded. If it was just created elsewhere, refresh the schema.`,
      fixes: suggestions(table, pool).map((name) => ({ title: `Change to ${name}`, replacement: requote(ref.token.text, name), start: ref.token.start, end: ref.token.end })),
    });
  }

  // An unqualified name can match a table in several schemas, and which one
  // the database picks depends on its search path. Each check therefore
  // holds for every candidate: a column is missing only if no candidate has
  // it, and a table has a column only if all of its candidates do.
  const candidates = (ref: TableRef): { keys: string[]; lists: string[][] } | undefined => {
    const keys = resolve(ref);
    if (!keys || !keys.length) return undefined;
    const lists = keys.map((key) => completions.tableColumns[key]);
    return lists.every(Boolean) ? { keys, lists: lists.map((list) => list.map((name) => name.toLowerCase())) } : undefined;
  };

  // Unknown columns behind a qualifier: alias.column or table.column.
  for (let i = 0; i + 2 < m.length; i++) {
    if (!isIdentifier(m[i]) || m[i + 1].text !== "." || !isIdentifier(m[i + 2])) continue;
    if (m[i - 1]?.text === "." || m[i + 3]?.text === "." || m[i + 3]?.text === "(" || tableTokens.has(m[i]) || tableTokens.has(m[i + 2])) continue;
    const qualifier = unquote(m[i].text);
    const owners = refs.filter((ref) => ref.alias === qualifier || (!ref.alias && ref.parts[ref.parts.length - 1] === qualifier));
    if (owners.length === 0) continue;
    const found = owners.map(candidates);
    if (found.some((item) => !item) || new Set(found.map((item) => item!.keys.join(","))).size !== 1) continue;
    const column = unquote(m[i + 2].text);
    if (found[0]!.lists.some((list) => list.includes(column))) continue;
    const pool = found[0]!.keys.flatMap((key) => completions.tableColumns[key]);
    const table = owners[0].parts.join(".");
    out.push({
      start: m[i + 2].start,
      end: m[i + 2].end,
      severity: "warning",
      code: "unknown-column",
      message: `${table} has no column ${m[i + 2].text}.`,
      fixes: suggestions(column, pool).map((name) => ({ title: `Change to ${name}`, replacement: requote(m[i + 2].text, name), start: m[i + 2].start, end: m[i + 2].end })),
    });
  }

  // Columns named without a qualifier that more than one table in the same
  // query has. Aliases given in the query are exempt, since ORDER BY and
  // GROUP BY may refer to them.
  const aliases = new Set<string>();
  for (let i = 0; i + 1 < m.length; i++) if (word(m[i]) === "as" && isIdentifier(m[i + 1])) aliases.add(unquote(m[i + 1].text));
  for (let i = 0; i < m.length; i++) {
    const token = m[i];
    if (!isIdentifier(token) || tableTokens.has(token) || !COLUMN_CLAUSES.has(clause[i]) || noAmbiguity.has(scopeOf[i])) continue;
    const name = unquote(token.text);
    if (RESERVED.has(name) || aliases.has(name) || /^\d/.test(name)) continue;
    const before = m[i - 1]?.text, next = m[i + 1]?.text;
    if (before === "." || before === "@" || before === ":" || word(m[i - 1]) === "as" || next === "." || next === "(") continue;
    if (refs.some((ref) => ref.alias === name)) continue;
    const owners = refs.filter((ref) => ref.scope === scopeOf[i] && ref.keyword !== "insert" && candidates(ref)?.lists.every((list) => list.includes(name)));
    const distinct = new Map(owners.map((ref) => [candidates(ref)!.keys.join(",") + "|" + (ref.alias ?? ""), ref]));
    if (distinct.size < 2) continue;
    out.push({
      start: token.start,
      end: token.end,
      severity: "warning",
      code: "ambiguous-column",
      message: `${token.text} is a column of ${[...distinct.values()].map((ref) => ref.alias ?? ref.parts.join(".")).join(" and ")}; say which.`,
      fixes: [...distinct.values()].map((ref) => {
        const qualifier = ref.alias ?? ref.token.text;
        return { title: `Change to ${qualifier}.${token.text}`, replacement: `${qualifier}.${token.text}`, start: token.start, end: token.end };
      }),
    });
  }
  return out;
}

// ---- Helpers ----

function word(token: SQLToken | undefined): string | undefined {
  return token?.kind === "word" ? token.text.toLowerCase() : undefined;
}

function isIdentifier(token: SQLToken | undefined): token is SQLToken {
  if (!token) return false;
  if (token.kind === "word") return !/^\d/.test(token.text);
  return token.kind === "quoted" && /^["`[]/.test(token.text);
}

function unquote(text: string): string {
  return (/^["`[]/.test(text) ? text.slice(1, -1) : text).toLowerCase();
}

function requote(original: string, name: string): string {
  if (original.startsWith("[")) return `[${name}]`;
  if (original.startsWith('"') || original.startsWith("`")) return `${original[0]}${name}${original[0]}`;
  return name;
}

function mainVerb(m: SQLToken[]): { word: string; index: number } {
  const first = word(m[0]) ?? "";
  if (first !== "with") return { word: first, index: 0 };
  let depth = 0;
  for (let i = 1; i < m.length; i++) {
    if (m[i].text === "(") depth++;
    else if (m[i].text === ")") depth--;
    else if (depth === 0 && ["select", "insert", "update", "delete", "merge"].includes(word(m[i]) ?? "")) return { word: word(m[i])!, index: i };
  }
  return { word: "", index: 0 };
}

function isRoutine(m: SQLToken[]): boolean {
  const words = m.slice(0, 6).map((token) => word(token) ?? "");
  return words[0] === "create" && words.some((item) => ["procedure", "proc", "function", "trigger", "event"].includes(item));
}

function cteNames(m: SQLToken[]): Set<string> {
  const names = new Set<string>();
  if (word(m[0]) !== "with") return names;
  let depth = 0;
  for (let i = 1; i < m.length; i++) {
    if (m[i].text === "(") depth++;
    else if (m[i].text === ")") depth--;
    else if (depth === 0) {
      const lower = word(m[i]);
      if (lower && ["select", "insert", "update", "delete", "merge"].includes(lower)) break;
      if (isIdentifier(m[i]) && lower !== "recursive" && lower !== "as" && lower !== "not" && lower !== "materialized") names.add(unquote(m[i].text));
    }
  }
  return names;
}

// Tables the script itself creates, anywhere in the editor, so a later
// statement using one is not reported.
function createdNames(statements: SQLToken[][]): Set<string> {
  const names = new Set<string>();
  for (const m of statements) {
    const verb = mainVerb(m);
    for (let i = 0; i < m.length; i++) {
      const lower = word(m[i]);
      if (i === 0 && lower === "create") {
        let j = 1;
        while (["or", "replace", "global", "local", "temporary", "temp", "unlogged", "materialized", "table", "view", "if", "not", "exists"].includes(word(m[j]) ?? "")) j++;
        if (!m.slice(1, j).some((token) => ["table", "view"].includes(word(token) ?? ""))) break;
        while (m[j + 1]?.text === "." && isIdentifier(m[j + 2])) j += 2;
        if (isIdentifier(m[j])) names.add(unquote(m[j].text));
        break;
      }
      if (lower === "into" && verb.word === "select") {
        let j = i + 1;
        while (m[j + 1]?.text === "." && isIdentifier(m[j + 2])) j += 2;
        if (isIdentifier(m[j])) names.add(unquote(m[j].text));
      }
    }
  }
  return names;
}

// Close names, for a typo: at most two edits, fewer for short names.
function suggestions(name: string, pool: string[]): string[] {
  const limit = Math.min(2, Math.max(1, Math.floor(name.length / 4)));
  const scored = [...new Set(pool)]
    .map((candidate) => ({ candidate, distance: editDistance(name, candidate.toLowerCase()) }))
    .filter((item) => item.distance > 0 && item.distance <= limit)
    .sort((a, b) => a.distance - b.distance || a.candidate.localeCompare(b.candidate));
  return scored.slice(0, 3).map((item) => item.candidate);
}

function editDistance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = previous[j];
      previous[j] = Math.min(previous[j] + 1, previous[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return previous[b.length];
}

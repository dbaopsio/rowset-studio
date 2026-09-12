import type { SchemaInfo } from "./api";
import { sqlTokens } from "./sqlText.ts";

/** One foreign key, in the direction it is written. */
export interface ForeignKey {
  /** Column of the table this key belongs to. */
  column: string;
  /** Table it points at, as schema.table lower-case. */
  table: string;
  toColumn: string;
}

export interface SqlCompletions {
  tableColumns: Record<string, string[]>;
  tableNames: Record<string, string>;
  schemaTables: Record<string, string[]>;
  schemaNames: Record<string, string>;
  routines: { name: string; kind: string }[];
  /** Keys of each table, both the ones it declares and the ones pointing at it. */
  foreignKeys?: Record<string, ForeignKey[]>;
  /** Databases a statement can name, keyed by lower-case name. */
  databaseNames?: Record<string, string>;
}

// Engines where one statement can reach another database by name.
const CROSS_DATABASE = new Set(["mysql", "mariadb", "mssql", "sqlserver"]);

const STOP_WORDS = new Set([
  "where", "on", "join", "inner", "left", "right", "full", "cross", "group",
  "order", "having", "limit", "offset", "union", "set", "values", "as", "using",
]);

export function aliasMap(sql: string): Record<string, string> {
  const map: Record<string, string> = {};
  const re = /\b(?:from|join|update|into)\s+(?:(["`[]?[\w$]+["`\]]?)\.)?(["`[]?[\w$]+["`\]]?)(?:\s+(?:as\s+)?([a-z_][\w$]*))?/gi;
  const clean = (value: string) => value.replace(/^["`[]|["`\]]$/g, "").toLowerCase();
  for (const match of sql.matchAll(re)) {
    const schema = match[1] ? clean(match[1]) : "";
    const table = clean(match[2]);
    if (STOP_WORDS.has(table)) continue;
    const qualified = schema ? `${schema}.${table}` : table;
    map[table] = qualified;
    map[qualified] = qualified;
    const alias = match[3]?.toLowerCase() ?? "";
    if (alias && !STOP_WORDS.has(alias)) map[alias] = qualified;
  }
  return map;
}

export function buildSqlCompletions(schema?: SchemaInfo, databases: string[] = [], engine = ""): SqlCompletions {
  const foreignKeys: Record<string, ForeignKey[]> = {};
  const tableColumns: Record<string, string[]> = {};
  const tableNames: Record<string, string> = {};
  const schemaTables: Record<string, string[]> = {};
  const schemaNames: Record<string, string> = {};
  const unqualified = new Map<string, { name: string; columns: string[] } | null>();
  const routines: { name: string; kind: string }[] = [];
  for (const schemaNode of schema?.schemas ?? []) {
    const schemaKey = schemaNode.name.toLowerCase();
    schemaNames[schemaKey] = schemaNode.name;
    schemaTables[schemaKey] = [];
    for (const table of [...schemaNode.tables, ...(schemaNode.views ?? [])]) {
      const tableKey = table.name.toLowerCase();
      const qualifiedKey = `${schemaKey}.${tableKey}`;
      const columns = table.columns.map((column) => column.name);
      tableColumns[qualifiedKey] = columns;
      tableNames[qualifiedKey] = `${schemaNode.name}.${table.name}`;
      unqualified.set(tableKey, unqualified.has(tableKey) ? null : { name: table.name, columns });
      schemaTables[schemaKey].push(table.name);
      for (const column of table.columns) {
        if (!column.references) continue;
        // references is schema.table.column; a key is useful from both ends.
        const parts = column.references.split(".");
        if (parts.length < 3) continue;
        const target = `${parts.slice(0, -2).join(".")}.${parts[parts.length - 2]}`.toLowerCase();
        const targetColumn = parts[parts.length - 1];
        (foreignKeys[qualifiedKey] ??= []).push({ column: column.name, table: target, toColumn: targetColumn });
        (foreignKeys[target] ??= []).push({ column: targetColumn, table: qualifiedKey, toColumn: column.name });
      }
    }
    routines.push(...(schemaNode.routines ?? []));
  }
  for (const [key, table] of unqualified) {
    if (!table) continue;
    tableColumns[key] = table.columns;
    tableNames[key] = table.name;
  }
  const databaseNames: Record<string, string> = {};
  if (CROSS_DATABASE.has(engine.toLowerCase())) {
    // MySQL calls a database a schema; it is listed once, as a schema.
    for (const name of databases) if (!schemaNames[name.toLowerCase()]) databaseNames[name.toLowerCase()] = name;
  }
  return { tableColumns, tableNames, schemaTables, schemaNames, routines, databaseNames, foreignKeys };
}

/** Where the cursor is, so the right kind of name is offered first. */
export type SqlClause = "select" | "from" | "where" | "group" | "order" | "set" | "other";

const CLAUSE_WORDS: Record<string, SqlClause> = {
  select: "select", from: "from", join: "from", into: "from", update: "from", table: "from",
  where: "where", on: "where", having: "where", and: "where", or: "where",
  group: "group", order: "order", set: "set", values: "set",
};

/**
 * Reads the clause the cursor sits in, ignoring anything inside brackets so a
 * subquery does not change the answer for the statement around it.
 */
export function clauseAt(sql: string, offset: number): SqlClause {
  let depth = 0;
  let clause: SqlClause = "other";
  for (const token of sqlTokens(sql.slice(0, offset))) {
    if (token.kind === "symbol") {
      if (token.text === "(") depth++;
      else if (token.text === ")") depth = Math.max(0, depth - 1);
      else if (token.text === ";") { depth = 0; clause = "other"; }
      continue;
    }
    if (token.kind !== "word" || depth > 0) continue;
    const word = CLAUSE_WORDS[token.text.toLowerCase()];
    if (word) clause = word;
  }
  return clause;
}

/**
 * Offers the joins the foreign keys allow from the tables already named in
 * the statement, with the ON clause filled in.
 */
export function joinSuggestions(sql: string, completions: SqlCompletions): { label: string; insertText: string; detail: string }[] {
  const keys = completions.foreignKeys ?? {};
  const aliases = aliasMap(sql);
  // A statement may name a table with or without its schema; keys are held
  // under the qualified name.
  const qualify = (name: string) => (keys[name] ? name : Object.keys(keys).find((key) => key.endsWith("." + name)) ?? name);
  const used = new Set(Object.values(aliases).map(qualify));
  const aliasOf = (table: string) => Object.entries(aliases).find(([alias, target]) => qualify(target) === table && alias !== target && !alias.includes("."))?.[0];
  const out: { label: string; insertText: string; detail: string }[] = [];
  const seen = new Set<string>();
  for (const table of used) {
    for (const key of keys[table] ?? []) {
      if (used.has(key.table) || seen.has(`${table}:${key.table}:${key.column}`)) continue;
      seen.add(`${table}:${key.table}:${key.column}`);
      const name = completions.tableNames[key.table] ?? key.table;
      const here = aliasOf(table) ?? (completions.tableNames[table] ?? table);
      const short = shortAlias(name, used, out.length);
      out.push({
        label: `JOIN ${name}`,
        insertText: `JOIN ${name} ${short} ON ${short}.${key.toColumn} = ${here}.${key.column}`,
        detail: `foreign key ${key.column} → ${name}.${key.toColumn}`,
      });
    }
  }
  return out;
}

function shortAlias(name: string, used: Set<string>, index: number) {
  const base = (name.split(".").pop() ?? name).replace(/[^\w]/g, "").slice(0, 1).toLowerCase() || "t";
  return used.has(base) ? `${base}${index + 1}` : base;
}

export function dotSuggestions(sql: string, identifier: string, completions: SqlCompletions): { kind: "column" | "table" | "schema"; values: string[]; owner?: string } {
  const ident = identifier.toLowerCase();
  const table = aliasMap(sql)[ident];
  const tableKey = table?.toLowerCase() ?? (completions.tableColumns[ident] ? ident : undefined);
  if (tableKey && completions.tableColumns[tableKey]) {
    return { kind: "column", values: completions.tableColumns[tableKey], owner: completions.tableNames[tableKey] ?? tableKey };
  }
  if (completions.schemaTables[ident]) {
    return { kind: "table", values: completions.schemaTables[ident] };
  }
  // SQL Server: database.schema.table. Only the open database's schemas are known.
  if (completions.databaseNames?.[ident]) {
    return { kind: "schema", values: Object.values(completions.schemaNames) };
  }
  return { kind: "column", values: [] };
}

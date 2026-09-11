import type { SchemaInfo } from "./api";

export interface SqlCompletions {
  tableColumns: Record<string, string[]>;
  tableNames: Record<string, string>;
  schemaTables: Record<string, string[]>;
  schemaNames: Record<string, string>;
  routines: { name: string; kind: string }[];
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
  return { tableColumns, tableNames, schemaTables, schemaNames, routines, databaseNames };
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

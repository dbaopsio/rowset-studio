import { mongoQuery } from "./mongoQuery";
import { createContext } from "react";

export interface SchemaAction { sql: string; connectionId: string; database?: string; append?: boolean }
export const SchemaActions = createContext<(action: SchemaAction) => void>(() => undefined);

export function quoteIdentifier(engine: string, name: string): string {
  if (engine === "mysql" || engine === "mariadb") return "`" + name.replace(/`/g, "``") + "`";
  if (engine === "mssql" || engine === "sqlserver") return "[" + name.replace(/]/g, "]]") + "]";
  return '"' + name.replace(/"/g, '""') + '"';
}

export function tableSelect(engine: string, schema: string, name: string, columns: string[] = []): string {
  if (engine === "mongodb") return mongoQuery(name);
  // Redis groups keys by type as a pseudo-table ("<db>.<type>"); open a scan
  // pre-filtered to that type.
  if (engine === "redis") return `{"pattern":"*","type":${JSON.stringify(name)},"limit":100}`;
  // Elasticsearch's pseudo-tables are indices.
  if (engine === "elasticsearch") return `{"index":${JSON.stringify(name)},"query":{"match_all":{}},"size":100}`;
  const target = [schema, name].filter(Boolean).map(n => quoteIdentifier(engine, n)).join(".");
  const select = columns.length ? columns.map(n => quoteIdentifier(engine, n)).join(", ") : "*";
  return engine === "mssql" || engine === "sqlserver" ? `SELECT TOP (100) ${select}\nFROM ${target};` : `SELECT ${select}\nFROM ${target}\nLIMIT 100;`;
}

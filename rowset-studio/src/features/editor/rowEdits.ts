// Turns edited result cells into UPDATE statements for the table the result
// came from. Rows are matched on their primary key values as received.

export interface ColumnOrigin {
  schema: string;
  table: string;
  column: string;
}

export interface EditTarget {
  schema: string;
  table: string;
  /** Source column name for each result column; null when not editable. */
  columns: (string | null)[];
  /** Result column indexes holding the primary key. */
  key: number[];
}

/** One changed row: its original values and the new value per result column. */
export interface RowEdit {
  row: unknown[];
  values: Map<number, string | null>;
}

export function quoteIdentifier(engine: string, name: string): string {
  if (engine === "mysql" || engine === "mariadb") return "`" + name.replaceAll("`", "``") + "`";
  if (engine === "mssql" || engine === "sqlserver") return "[" + name.replaceAll("]", "]]") + "]";
  return '"' + name.replaceAll('"', '""') + '"';
}

export function sqlLiteral(engine: string, value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "boolean") return engine === "postgres" ? (value ? "TRUE" : "FALSE") : value ? "1" : "0";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  let text = typeof value === "object" ? JSON.stringify(value) : String(value);
  if (engine === "mysql" || engine === "mariadb") text = text.replaceAll("\\", "\\\\");
  text = text.replaceAll("'", "''");
  return engine === "mssql" || engine === "sqlserver" ? `N'${text}'` : `'${text}'`;
}

/**
 * Finds the single table a result can be edited in: every traced column comes
 * from it and its whole primary key is in the result. Returns null otherwise.
 */
export function editTarget(origins: (ColumnOrigin | null)[] | undefined, primaryKey: (schema: string, table: string) => string[] | null): EditTarget | null {
  if (!origins?.length) return null;
  const traced = origins.filter((origin): origin is ColumnOrigin => origin !== null);
  if (!traced.length) return null;
  const { schema, table } = traced[0];
  if (traced.some((origin) => origin.schema !== schema || origin.table !== table)) return null;
  const pk = primaryKey(schema, table);
  if (!pk?.length) return null;
  const columns = origins.map((origin) => origin?.column ?? null);
  const key = pk.map((name) => columns.findIndex((column) => column !== null && column.toLowerCase() === name.toLowerCase()));
  if (key.some((index) => index < 0)) return null;
  return { schema, table, columns, key };
}

export function updateStatements(engine: string, target: EditTarget, edits: RowEdit[]): string[] {
  const tableName = (target.schema ? quoteIdentifier(engine, target.schema) + "." : "") + quoteIdentifier(engine, target.table);
  return edits
    .filter((edit) => edit.values.size > 0)
    .map((edit) => {
      const assignments = [...edit.values.entries()]
        .filter(([index]) => target.columns[index] && !target.key.includes(index))
        .map(([index, value]) => `${quoteIdentifier(engine, target.columns[index]!)} = ${sqlLiteral(engine, value)}`);
      const where = target.key.map((index) => {
        const value = edit.row[index];
        const column = quoteIdentifier(engine, target.columns[index]!);
        return value === null || value === undefined ? `${column} IS NULL` : `${column} = ${sqlLiteral(engine, value)}`;
      });
      return assignments.length ? `UPDATE ${tableName} SET ${assignments.join(", ")} WHERE ${where.join(" AND ")}` : "";
    })
    .filter(Boolean);
}

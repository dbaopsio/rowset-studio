export interface ExportResult { columns: string[]; rows: unknown[][]; columnTypes?: string[] }

// Duplicate labels remain separate columns; JSON consumers can map values by
// ordinal, including joins that return two columns named "id".
export function resultJSON(result: ExportResult): string {
  return JSON.stringify({ columns: result.columns, columnTypes: result.columnTypes, rows: result.rows }, null, 2);
}

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = typeof value === "object" ? JSON.stringify(value) : String(value);
  // Spreadsheet-safe default for text from databases. Numeric values retain
  // their numeric representation; text beginning with formula markers is escaped.
  if (typeof value === "string" && /^[\t\r\n ]*[=+@-]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function resultCSV(result: ExportResult): string {
  return [result.columns.map(csvCell).join(","), ...result.rows.map(row => row.map(csvCell).join(","))].join("\r\n");
}

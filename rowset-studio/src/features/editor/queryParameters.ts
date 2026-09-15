import { hashComments, sqlTokens } from "./sqlText.ts";
export interface QueryParameter { type: "text" | "number" | "boolean" | "null"; value: string }
export type QueryParameters = Record<string, QueryParameter>;

function occurrences(sql: string, engine: string) {
  const protectedTokens = sqlTokens(sql, { hashComments: hashComments(engine) }).filter(token => token.kind === "quoted" || token.kind === "comment");
  return [...sql.matchAll(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g)].filter(match => !protectedTokens.some(token => match.index! >= token.start && match.index! < token.end));
}
export function parameterNames(sql: string, engine: string): string[] {
  return [...new Set(occurrences(sql, engine).map(match => match[1]))];
}
function literal(parameter: QueryParameter, engine: string): string {
  if (parameter.type === "null") return "NULL";
  if (parameter.type === "number") {
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(parameter.value.trim())) throw new Error("Enter a valid number.");
    return parameter.value.trim(); // Never round through a JavaScript number.
  }
  if (parameter.type === "boolean") {
    if (!["true", "false"].includes(parameter.value)) throw new Error("Choose true or false.");
    return ["sqlserver", "sqlite"].includes(engine) ? parameter.value === "true" ? "1" : "0" : parameter.value.toUpperCase();
  }
  if (parameter.value.includes("\0")) throw new Error("Text parameters cannot contain NUL.");
  const hex = [...new TextEncoder().encode(parameter.value)].map(byte => byte.toString(16).padStart(2, "0")).join("");
  // Hex expressions avoid dependence on MySQL NO_BACKSLASH_ESCAPES and
  // ClickHouse backslash escaping rules. Text is always a value, never SQL.
  if (engine === "mysql" || engine === "mariadb") return `CONVERT(X'${hex}' USING utf8mb4)`;
  if (engine === "clickhouse") return `unhex('${hex}')`;
  const text = parameter.value.replaceAll("'", "''");
  if (engine === "postgres") return `E'${text.replaceAll("\\", "\\\\")}'`;
  return `${engine === "sqlserver" ? "N" : ""}'${text}'`;
}
export function resolveParameters(sql: string, engine: string, values: QueryParameters): string {
  const matches = occurrences(sql, engine);
  let result = sql;
  for (const match of matches.reverse()) {
    const parameter = Object.hasOwn(values, match[1]) ? values[match[1]] : undefined;
    if (!parameter) throw new Error(`Set parameter ${match[1]} before running.`);
    let replacement: string;
    try { replacement = literal(parameter, engine); }
    catch (error) { throw new Error(`${match[1]}: ${(error as Error).message}`, { cause: error }); }
    result = result.slice(0, match.index) + replacement + result.slice(match.index! + match[0].length);
  }
  return result;
}

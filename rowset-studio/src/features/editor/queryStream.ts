export interface StreamResult {
  columns: string[]; columnTypes?: string[]; rows: unknown[][]; rowCount: number;
  durationMs: number; truncated?: boolean; policyNotice?: string;
  /** Table column behind each result column, null where unknown. */
  columnOrigins?: ({ schema: string; table: string; column: string } | null)[];
  /** Fields the server added on behalf of its extensions. */
  annotations?: Record<string, unknown>;
}

const RESULT_FIELDS = new Set(["type", "columns", "columnTypes", "columnOrigins", "rows", "rowCount", "rowsAffected", "durationMs", "truncated", "policyNotice", "error", "status", "message"]);

/** Returns the fields of a result message that the result format does not define. */
export function resultAnnotations(source: Record<string, unknown>): Record<string, unknown> {
  const annotations: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) if (!RESULT_FIELDS.has(key)) annotations[key] = value;
  return annotations;
}

// Long results report progress less often, so rendering never costs more
// than receiving.
function progressInterval(rows: number) {
  return rows > 200_000 ? 2000 : rows > 20_000 ? 500 : 100;
}

export async function readQueryStream(response: Response, onProgress?: (result: StreamResult) => void): Promise<StreamResult> {
  if (!response.body) throw new Error("Missing query response body");
  const result: StreamResult = { columns: [], rows: [], rowCount: 0, durationMs: 0 };
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = "", complete = false, receivedColumns = false;
  let lastProgress = 0;
  function accept(line: string) {
    if (!line.trim()) return;
    if (complete) throw new Error("Unexpected data after query completion");
    const event = JSON.parse(line);
    if (event.type === "columns") {
      if (receivedColumns || !Array.isArray(event.columns) || !event.columns.every((column: unknown) => typeof column === "string")) throw new Error("Invalid query metadata");
      receivedColumns = true;
      result.columns = event.columns; result.columnTypes = event.columnTypes; result.columnOrigins = event.columnOrigins ?? undefined;
      result.annotations = resultAnnotations(event);
    } else if (event.type === "rows") {
      if (!receivedColumns || !Array.isArray(event.rows) || !event.rows.every((row: unknown) => Array.isArray(row) && row.length === result.columns.length)) throw new Error("Invalid query row batch");
      for (const row of event.rows) result.rows.push(row);
      result.rowCount = result.rows.length;
      // Report progress without copying the rows: copying them on every
      // update would cost more the longer a large result streams. The grid
      // reads the growing array and re-renders on the new wrapper object.
      if (Date.now() - lastProgress > progressInterval(result.rowCount)) { onProgress?.({ ...result }); lastProgress = Date.now(); }
    } else if (event.type === "complete") {
      complete = true;
      if (event.error) throw new Error(event.error);
      if (!receivedColumns || event.rowCount !== result.rows.length || !Number.isFinite(event.durationMs) || event.durationMs < 0) throw new Error("Invalid query completion metadata");
      result.rowCount = event.rowCount; result.durationMs = event.durationMs;
      result.truncated = event.truncated; result.policyNotice = event.policyNotice;
    } else throw new Error("Unknown query stream event");
  }
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) { accept(buffer.slice(0, newline)); buffer = buffer.slice(newline + 1); }
      if (done) break;
    }
    if (buffer.trim()) accept(buffer);
    if (!complete || !receivedColumns) throw new Error("Query response interrupted before completion");
    return result;
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}

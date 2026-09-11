import { api, apiResponse, ApiError } from "../../lib/api";
import { readQueryStream, resultAnnotations } from "./queryStream";

export interface QueryResult {
  columns: string[];
  rows: unknown[][];
  rowCount: number;
  durationMs: number;
  truncated?: boolean;
  policyNotice?: string;
  columnTypes?: string[];
  /** Table column behind each result column, null where unknown. */
  columnOrigins?: ({ schema: string; table: string; column: string } | null)[];
  /** Fields the server added on behalf of its extensions. */
  annotations?: Record<string, unknown>;
}

export interface HistoryItem {
  id: string;
  connectionId?: string;
  sql: string;
  status: string;
  rowsReturned: number;
  durationMs: number;
  createdAt: string;
}

export interface ColumnInfo {
  name: string;
  dataType: string;
  nullable: boolean;
  pk?: boolean;
  references?: string; // "schema.table.column" for FK columns
  default?: string;
  generated?: string;
  comment?: string;
}
export interface IndexInfo {
  name: string;
  columns: string[];
  unique?: boolean;
  primary?: boolean;
}
export interface TableInfo {
  name: string;
  columns: ColumnInfo[];
  indexes?: IndexInfo[];
}
export interface RoutineInfo {
  name: string;
  kind: string; // "procedure" | "function"
}
export interface TriggerInfo {
  name: string;
  table: string;
  timing: string;
  event: string;
}
export interface SchemaNode {
  name: string;
  tables: TableInfo[];
  views?: TableInfo[];
  routines?: RoutineInfo[];
  triggers?: TriggerInfo[];
}
export interface SchemaInfo {
  schemas: SchemaNode[];
  warnings?: string[];
}

// Commands (INSERT/DDL/SET/...) come back as {rowsAffected, durationMs}
// instead of a result set; normalize both shapes into QueryResult.
interface RawQueryResponse extends Partial<QueryResult> {
  rowsAffected?: number;
  durationMs: number;
  error?: string;
}

function normalizeResult(r: RawQueryResponse): QueryResult {
  if (r.error) throw new Error(r.error);
  return {
    columns: r.columns ?? [],
    rows: r.rows ?? [],
    rowCount: r.rowCount ?? r.rowsAffected ?? 0,
    durationMs: r.durationMs,
    truncated: r.truncated ?? false,
    policyNotice: r.policyNotice,
    columnTypes: r.columnTypes,
    columnOrigins: r.columnOrigins ?? undefined,
    annotations: resultAnnotations(r as unknown as Record<string, unknown>),
  };
}

// A 202 means the server held the statement instead of running it.
async function readResult(response: Response, onProgress?: (result: QueryResult) => void): Promise<QueryResult> {
  if (response.status === 202) {
    const body = (await response.json().catch(() => ({}))) as { message?: string };
    throw new ApiError(202, { code: "PENDING", message: body.message ?? "The statement is waiting and has not run." });
  }
  return response.headers.get("Content-Type")?.includes("application/x-ndjson") ? readQueryStream(response, onProgress) : normalizeResult(await response.json());
}

export async function runQuery(connectionId: string, sql: string, database?: string, nodeRole?: "primary" | "secondary", signal?: AbortSignal, onProgress?: (result: QueryResult) => void, backup = false, maxRows = 1000) {
  const response = await apiResponse(`/connections/${connectionId}/query`, {
    method: "POST",
    signal,
    headers: { Accept: "application/x-ndjson" },
    body: JSON.stringify({ sql, database: database ?? "", nodeRole, maxRows, backup }),
  });
  return readResult(response, onProgress);
}

// ---- Manual transactions ----

export function beginTxn(connectionId: string, database?: string) {
  return api<{ txnId: string }>(`/connections/${connectionId}/txn/begin`, {
    method: "POST",
    body: JSON.stringify({ database: database ?? "" }),
  });
}

export async function txnQuery(connectionId: string, txnId: string, sql: string, database?: string, signal?: AbortSignal, onProgress?: (result: QueryResult) => void, backup = false, maxRows = 1000) {
  const response = await apiResponse(`/connections/${connectionId}/txn/${txnId}/query`, {
    method: "POST",
    headers: { Accept: "application/x-ndjson" },
    body: JSON.stringify({ sql, database: database ?? "", maxRows, backup }),
    signal,
  });
  return readResult(response, onProgress);
}

export function commitTxn(connectionId: string, txnId: string) {
  return api<void>(`/connections/${connectionId}/txn/${txnId}/commit`, { method: "POST" });
}

export function rollbackTxn(connectionId: string, txnId: string) {
  return api<void>(`/connections/${connectionId}/txn/${txnId}/rollback`, { method: "POST" });
}

export interface PlanResult {
  engine: string;
  format: "json" | "xml" | "text";
  analyzed: boolean;
  plan: string;
}

// Returns the execution plan of one statement. analyze runs a SELECT to
// measure actual rows and timings.
export function explainQuery(connectionId: string, sql: string, options: { database?: string; nodeRole?: "primary" | "secondary"; analyze: boolean }) {
  return api<PlanResult>(`/connections/${connectionId}/explain`, {
    method: "POST",
    body: JSON.stringify({ sql, database: options.database ?? "", nodeRole: options.nodeRole, analyze: options.analyze }),
  });
}

// Downloads a whole table, or the full result of one SELECT; the server
// applies policies as for any SELECT.
export async function exportTable(connectionId: string, request: { database?: string; schema?: string; table?: string; sql?: string; format: "csv" | "json" }) {
  const response = await apiResponse(`/connections/${connectionId}/export`, { method: "POST", body: JSON.stringify({ ...request, database: request.database ?? "" }) });
  return response.blob();
}

// CSV import: upload the file in chunks, then insert it in one transaction.
export function startImport(connectionId: string) {
  return api<{ importId: string }>(`/connections/${connectionId}/imports`, { method: "POST" });
}

export function uploadImportChunk(connectionId: string, importId: string, chunk: Blob) {
  return api<{ size: number }>(`/connections/${connectionId}/imports/${importId}`, { method: "PUT", body: chunk });
}

export interface ImportRequest {
  schema: string;
  table: string;
  database: string;
  header: boolean;
  delimiter: string;
  nullEmpty: boolean;
  columns: { source: number; target: string }[];
}

export function runImport(connectionId: string, importId: string, request: ImportRequest) {
  return api<{ rows: number; durationMs: number }>(`/connections/${connectionId}/imports/${importId}/run`, { method: "POST", body: JSON.stringify(request) });
}

export function discardImport(connectionId: string, importId: string) {
  return api<void>(`/connections/${connectionId}/imports/${importId}`, { method: "DELETE" });
}

export function listDatabases(connectionId: string) {
  return api<{ databases: string[] | null }>(`/connections/${connectionId}/databases`).then((r) => r.databases ?? []);
}

export function listHistory(connectionId: string, filters?: { from?: string; to?: string }) {
  const qs = new URLSearchParams();
  if (filters?.from) qs.set("from", filters.from);
  if (filters?.to) qs.set("to", filters.to);
  const suffix = qs.size ? `?${qs.toString()}` : "";
  return api<{ history: HistoryItem[] | null }>(`/connections/${connectionId}/history${suffix}`).then(
    (r) => r.history ?? [],
  );
}

// The signed-in user's own statements across all connections (max 200).
export function listMyHistory(filters?: { from?: string; to?: string }) {
  const qs = new URLSearchParams();
  if (filters?.from) qs.set("from", filters.from);
  if (filters?.to) qs.set("to", filters.to);
  const suffix = qs.size ? `?${qs.toString()}` : "";
  return api<{ history: HistoryItem[] | null }>(`/history${suffix}`).then((r) => r.history ?? []);
}

export function getSchema(connectionId: string, database?: string) {
  const qs = database ? `?database=${encodeURIComponent(database)}` : "";
  return api<SchemaInfo>(`/connections/${connectionId}/schema${qs}`).then(normalizeSchema);
}

// Older Rowset versions serialized Go's Index fields as
// Name/Columns/Unique/Primary. Normalize both shapes so cached or
// rolling-upgrade responses cannot crash the explorer.
function normalizeSchema(input: SchemaInfo): SchemaInfo {
  return {
    warnings: input?.warnings ?? [],
    schemas: (input?.schemas ?? []).map((schema) => ({
      ...schema,
      tables: (schema.tables ?? []).map(normalizeTable),
      views: (schema.views ?? []).map(normalizeTable),
      routines: schema.routines ?? [],
      triggers: schema.triggers ?? [],
    })),
  };
}

function normalizeTable(table: TableInfo): TableInfo {
  const indexes = (table.indexes ?? []).map((raw) => {
    const legacy = raw as IndexInfo & { Name?: string; Columns?: string[]; Unique?: boolean; Primary?: boolean };
    return {
      name: legacy.name ?? legacy.Name ?? "index",
      columns: legacy.columns ?? legacy.Columns ?? [],
      unique: legacy.unique ?? legacy.Unique ?? false,
      primary: legacy.primary ?? legacy.Primary ?? false,
    };
  });
  return { ...table, columns: table.columns ?? [], indexes };
}

export interface SavedQuery {
  id: string;
  connectionId: string;
  name: string;
  sql: string;
  createdAt: string;
}

export function listSavedQueries() {
  return api<{ queries: SavedQuery[] | null }>("/saved-queries").then((r) => r.queries ?? []);
}

export function saveQuery(input: { connectionId: string | null; name: string; sql: string }) {
  return api<SavedQuery>("/saved-queries", {
    method: "POST",
    body: JSON.stringify({ connectionId: input.connectionId ?? "", name: input.name, sql: input.sql }),
  });
}

export function deleteSavedQuery(id: string) {
  return api<void>(`/saved-queries/${id}`, { method: "DELETE" });
}

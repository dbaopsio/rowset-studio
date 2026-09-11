import { api } from "../../lib/api";

export type NotebookCellKind = "markdown" | "sql";

export interface NotebookCell {
  id: string;
  kind: NotebookCellKind;
  content: string;
  connectionId?: string | null;
  database?: string;
}

export interface NotebookDocument {
  title: string;
  cells: NotebookCell[];
}

export interface NotebookSummary {
  id: string;
  title: string;
  cellCount: number;
  revision: number;
  updatedAt: string;
  unreadable?: boolean;
}

export interface Notebook {
  id: string;
  revision: number;
  updatedAt: string;
  document: NotebookDocument;
}

// The server stores connectionId as a plain optional string.
function wire(document: NotebookDocument): NotebookDocument {
  return {
    title: document.title,
    cells: document.cells.map(({ connectionId, database, ...cell }) => ({
      ...cell,
      ...(connectionId ? { connectionId } : {}),
      ...(database ? { database } : {}),
    })),
  };
}

export function listNotebooks() {
  return api<{ notebooks: NotebookSummary[] | null }>("/notebooks").then((r) => r.notebooks ?? []);
}

export function getNotebook(id: string) {
  return api<Notebook>(`/notebooks/${encodeURIComponent(id)}`);
}

export function createNotebook(document: NotebookDocument) {
  return api<Notebook>("/notebooks", { method: "POST", body: JSON.stringify({ document: wire(document) }) });
}

export function saveNotebook(id: string, revision: number, document: NotebookDocument) {
  return api<{ revision: number; updatedAt: string }>(`/notebooks/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify({ revision, document: wire(document) }),
  });
}

export function deleteNotebook(id: string) {
  return api<void>(`/notebooks/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function newCell(kind: NotebookCellKind, content = "", extra: Partial<NotebookCell> = {}): NotebookCell {
  return { id: crypto.randomUUID(), kind, content, ...extra };
}

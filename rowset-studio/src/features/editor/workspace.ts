export interface WorkspaceTab {
  id: string; title: string; sql: string; connectionId?: string | null;
  database?: string; nodeRole?: "primary" | "secondary";
  /** Row backup this tab restores; its statements are not backed up again. */
  restoreOf?: string;
}
export interface WorkspaceDocument { version: 1; tabs: WorkspaceTab[]; activeTabId: string }
export interface WorkspaceSnapshot { revision: number; document: WorkspaceDocument | null }

export function validWorkspace(value: unknown): value is WorkspaceDocument {
  if (!value || typeof value !== "object") return false;
  const doc = value as WorkspaceDocument;
  if (doc.version !== 1 || !Array.isArray(doc.tabs) || !doc.tabs.length || doc.tabs.length > 100) return false;
  const ids = new Set<string>();
  for (const tab of doc.tabs) {
    if (!tab || typeof tab.id !== "string" || !tab.id || tab.id.length > 128 || ids.has(tab.id) ||
      typeof tab.title !== "string" || tab.title.length > 512 || typeof tab.sql !== "string" ||
      (tab.database !== undefined && (typeof tab.database !== "string" || tab.database.length > 512)) ||
      (tab.connectionId != null && (typeof tab.connectionId !== "string" || tab.connectionId.length > 128)) ||
      (tab.nodeRole !== undefined && !["primary", "secondary"].includes(tab.nodeRole)) ||
      (tab.restoreOf !== undefined && (typeof tab.restoreOf !== "string" || tab.restoreOf.length > 128))) return false;
    ids.add(tab.id);
  }
  return ids.has(doc.activeTabId);
}

// Coalesce edits while a request is in flight; never send two writes against the
// same revision. After any error, require an explicit retry (409 stays a conflict).
export class WorkspaceWriter {
  revision: number;
  current: WorkspaceDocument;
  saved: string;
  error: Error | null = null;
  private running: Promise<void> | null = null;
  private write: (revision: number, document: WorkspaceDocument) => Promise<{ revision: number }>;
  private changed: () => void;
  constructor(snapshot: WorkspaceSnapshot, initial: WorkspaceDocument,
    write: (revision: number, document: WorkspaceDocument) => Promise<{ revision: number }>,
    changed: () => void) {
    this.write = write; this.changed = changed;
    this.revision = snapshot.revision; this.current = initial;
    this.saved = snapshot.document ? JSON.stringify(snapshot.document) : "";
  }
  get dirty() { return JSON.stringify(this.current) !== this.saved; }
  update(document: WorkspaceDocument) { this.current = document; }
  flush(): Promise<void> {
    if (this.running) return this.running;
    if (this.error || !this.dirty) return Promise.resolve();
    this.running = this.drain().finally(() => { this.running = null; this.changed(); });
    return this.running;
  }
  retry() { this.error = null; return this.flush(); }
  private async drain() {
    try {
      while (this.dirty) {
        const document = this.current, serialized = JSON.stringify(document);
        if (!validWorkspace(document)) throw new Error("Workspace has invalid tabs or more than 100 tabs. Export your SQL before closing tabs.");
        if (new TextEncoder().encode(JSON.stringify({ revision: this.revision, document })).length > 768 * 1024) throw new Error("Workspace exceeds 768 KB. Save large SQL files separately before closing tabs.");
        const result = await this.write(this.revision, document);
        if (result.revision !== this.revision + 1) throw new Error("Unexpected workspace revision. Reopen after exporting your drafts.");
        this.revision = result.revision; this.saved = serialized;
        this.changed();
      }
    } catch (error) { this.error = error instanceof Error ? error : new Error("Workspace save failed"); this.changed(); }
  }
}

export function mergeWorkspace(base: WorkspaceDocument, recovery: unknown, newID: () => string): WorkspaceDocument {
  if (!validWorkspace(recovery)) throw new Error("Invalid workspace file. Existing tabs were not changed.");
  if (base.tabs.length + recovery.tabs.length > 100) throw new Error("Recovery would exceed 100 tabs. Export your drafts before closing tabs.");
  const added = recovery.tabs.map(tab => ({ ...tab, id: newID() }));
  return { version: 1, tabs: [...base.tabs, ...added], activeTabId: added[recovery.tabs.findIndex(tab => tab.id === recovery.activeTabId)].id };
}

import { useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { validWorkspace, mergeWorkspace, WorkspaceWriter, type WorkspaceDocument, type WorkspaceSnapshot } from "./workspace";

function userKey() {
  const user = useAuth.getState().user;
  return `${user?.orgId}:${user?.userId}`;
}
function recoveryPrefix() { return `rowset.workspace.recovery:${userKey()}:`; }

function legacyWorkspace(): WorkspaceDocument {
  try {
    const tabs = JSON.parse(localStorage.getItem(`rowset.editor.tabs:${userKey()}`) ?? "null");
    const active = localStorage.getItem(`rowset.editor.activeTab:${userKey()}`);
    const document = { version: 1, tabs, activeTabId: tabs?.some((tab: { id: string }) => tab?.id === active) ? active : tabs?.[0]?.id };
    if (validWorkspace(document)) return document;
  } catch { /* Leave invalid legacy storage untouched. */ }
  return { version: 1, tabs: [{ id: "q-1", title: "Query 1", sql: "" }], activeTabId: "q-1" };
}

function localRecoveries() {
  const found: { key: string; document: WorkspaceDocument; date: string }[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(recoveryPrefix())) continue;
      try {
        const item = JSON.parse(localStorage.getItem(key) ?? "null");
        if (validWorkspace(item?.document)) found.push({ key, document: item.document, date: String(item.date ?? "") });
      } catch { /* Preserve unrecognized recovery data. */ }
    }
  } catch { /* Browser storage can be disabled. */ }
  return found.sort((a, b) => b.date.localeCompare(a.date));
}

export function exportWorkspace(workspace: WorkspaceDocument) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(workspace, null, 2)], { type: "application/json" }));
  const link = document.createElement("a"); link.href = url; link.download = "rowset-workspace.json";
  link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function WorkspaceGate({ children }: { children: (snapshot: WorkspaceSnapshot, initial: WorkspaceDocument) => ReactNode }) {
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot | null>(null);
  const [initial, setInitial] = useState<WorkspaceDocument | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [recoveries] = useState(localRecoveries);
  useEffect(() => {
    let alive = true;
    api<WorkspaceSnapshot>("/workspace").then(value => {
      if (!Number.isSafeInteger(value.revision) || value.revision < 0 || (value.document !== null && !validWorkspace(value.document))) throw new Error("Invalid saved workspace. Existing drafts were not changed.");
      if (alive) { setSnapshot(value); if (!recoveries.length) setInitial(value.document ?? legacyWorkspace()); }
    }).catch(err => { if (alive) setError(err instanceof Error ? err.message : "Workspace unavailable"); });
    return () => { alive = false; };
  }, [attempt, recoveries.length]);
  if (error) return <div className="p-6 text-sm"><p>{error}</p><button className="underline" onClick={() => { setError(""); setAttempt(n => n + 1); }}>Retry loading workspace</button>{recoveries.map(item => <button key={item.key} className="block underline" onClick={() => exportWorkspace(item.document)}>Export local recovery {item.date}</button>)}</div>;
  if (!snapshot) return <p className="p-6 text-sm">Loading your saved workspace…</p>;
  if (!initial) return <div className="space-y-3 p-6 text-sm">
    <p>Local unsaved drafts were found. The server workspace has not been changed.</p>
    <button className="underline" onClick={() => setInitial(snapshot.document ?? legacyWorkspace())}>Open saved workspace</button>
    {recoveries.map(item => <div key={item.key} className="flex gap-3">
      <span>{item.date} · {item.document.tabs.length} tabs</span>
      <button className="underline" onClick={() => exportWorkspace(item.document)}>Export recovery</button>
      <button className="underline" onClick={() => {
        try { setInitial(mergeWorkspace(snapshot.document ?? legacyWorkspace(), item.document, () => crypto.randomUUID())); }
        catch (error) { setError(error instanceof Error ? error.message : "Recovery failed"); }
      }}>Recover as additional tabs</button>
    </div>)}
    <p>Recovery copies are retained in this browser until you remove them from browser storage.</p>
  </div>;
  return children(snapshot, initial);
}

export function useWorkspacePersistence(snapshot: WorkspaceSnapshot, initial: WorkspaceDocument, current: WorkspaceDocument) {
  const [, refresh] = useState(0);
  const [storageError, setStorageError] = useState(false);
  const writerRef = useRef<WorkspaceWriter | null>(null);
  const key = useRef(`${recoveryPrefix()}${crypto.randomUUID()}`);
  const alive = useRef(false);
  if (!writerRef.current) writerRef.current = new WorkspaceWriter(snapshot, initial,
    (revision, document) => api("/workspace", { method: "PUT", body: JSON.stringify({ revision, document }) }),
    () => { if (alive.current) refresh(n => n + 1); });
  const writer = writerRef.current;
  writer.update(current);
  const backup = () => {
    try {
      if (writer.dirty) localStorage.setItem(key.current, JSON.stringify({ date: new Date().toISOString(), document: writer.current }));
      else localStorage.removeItem(key.current);
      if (alive.current) setStorageError(false);
    } catch { if (alive.current) setStorageError(true); }
  };
  const backupRef = useRef(backup); backupRef.current = backup;
  useEffect(() => {
    alive.current = true;
    const leave = (event: BeforeUnloadEvent) => { backupRef.current(); if (writer.dirty) { event.preventDefault(); event.returnValue = ""; } };
    const hide = () => { backupRef.current(); void writer.flush(); };
    window.addEventListener("beforeunload", leave); window.addEventListener("pagehide", hide);
    return () => { alive.current = false; backupRef.current(); void writer.flush().then(() => backupRef.current()); window.removeEventListener("beforeunload", leave); window.removeEventListener("pagehide", hide); };
  }, [writer]);
  useEffect(() => {
    const backupTimer = setTimeout(() => backupRef.current(), 100);
    const timer = setTimeout(() => { void writer.flush().then(() => backupRef.current()); }, 400);
    return () => { clearTimeout(timer); clearTimeout(backupTimer); };
  }, [current.tabs, current.activeTabId, writer]);
  return { dirty: writer.dirty, error: writer.error?.message, storageError, retry: () => { void writer.retry().then(() => backupRef.current()); } };
}

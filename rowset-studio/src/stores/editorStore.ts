// Editor UI state only (per the state rule: server data lives in TanStack Query,
// ephemeral UI state lives here in Zustand).
import { create } from "zustand";

const ACTIVE_CONNECTION_KEY = "rowset.editor.activeConnection";

interface EditorState {
  sql: string;
  activeConnectionId: string | null;
  setSql: (sql: string) => void;
  setActiveConnection: (id: string | null) => void;
}

export const useEditorStore = create<EditorState>((set) => ({
  sql: "SELECT 1;",
  activeConnectionId: localStorage.getItem(ACTIVE_CONNECTION_KEY),
  setSql: (sql) => set({ sql }),
  setActiveConnection: (activeConnectionId) => {
    if (activeConnectionId) localStorage.setItem(ACTIVE_CONNECTION_KEY, activeConnectionId);
    else localStorage.removeItem(ACTIVE_CONNECTION_KEY);
    set({ activeConnectionId });
  },
}));

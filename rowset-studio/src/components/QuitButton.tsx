import { useState } from "react";
import { Icon } from "./Icon";
import { api } from "../lib/api";
import { useInstance } from "../lib/instance";

// Stops the local server of the desktop app. Open transactions are rolled
// back; committed changes stay in the database.
export default function QuitButton({ collapsed }: { collapsed: boolean }) {
  const { data } = useInstance();
  const [stopped, setStopped] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!data?.desktop) return null;

  async function quit() {
    if (!window.confirm("Quit Rowset Studio? Running queries stop and open transactions are rolled back. Committed changes remain saved.")) return;
    setBusy(true);
    try {
      await api<void>("/local/quit?rollback=true", { method: "POST" });
      setStopped(true);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Rowset Studio could not quit.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        onClick={quit}
        disabled={busy}
        title="Quit Rowset"
        className={
          collapsed
            ? "grid h-8 w-8 place-items-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 disabled:opacity-50 dark:text-slate-400 dark:hover:bg-slate-900 dark:hover:text-slate-100"
            : "flex h-8 w-full items-center gap-2 rounded-md px-2 text-[13px] text-slate-600 transition hover:bg-slate-50 hover:text-slate-900 disabled:opacity-50 dark:text-slate-300 dark:hover:bg-slate-900 dark:hover:text-slate-100"
        }
      >
        <Icon name="power" size={collapsed ? 16 : 15} />
        {!collapsed && "Quit Rowset"}
      </button>
      {stopped && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-paper/95 p-6 text-center dark:bg-[#121317]/95">
          <div className="max-w-sm space-y-2">
            <p className="text-[15px] font-semibold text-slate-900 dark:text-slate-100">Rowset Studio has stopped</p>
            <p className="text-[13px] text-slate-500 dark:text-slate-400">You can close this tab. Start Rowset Studio again from the applications menu or with <code>rowset</code>.</p>
          </div>
        </div>
      )}
    </>
  );
}

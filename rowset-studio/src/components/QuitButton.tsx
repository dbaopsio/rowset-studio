import { useState } from "react";
import { Icon } from "./Icon";
import { Button, Modal } from "./ui";
import { api } from "../lib/api";
import { useInstance } from "../lib/instance";

// Shuts down the local server of the desktop app. Open transactions are rolled
// back; committed changes stay in the database.
export default function QuitButton({ collapsed }: { collapsed: boolean }) {
  const { data } = useInstance();
  const [confirming, setConfirming] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!data?.desktop) return null;

  async function shutdown() {
    setBusy(true);
    setError("");
    try {
      await api<void>("/local/quit?rollback=true", { method: "POST" });
      setConfirming(false);
      setStopped(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Rowset Studio could not shut down.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setConfirming(true)}
        title="Shutdown Rowset"
        aria-label="Shutdown Rowset"
        className={`grid ${collapsed ? "h-8 w-8" : "h-7 w-7"} shrink-0 place-items-center rounded-md text-rose-600 transition hover:bg-rose-50 hover:text-rose-700 dark:text-rose-300 dark:hover:bg-rose-950/40 dark:hover:text-rose-200`}
      >
        <Icon name="power" size={collapsed ? 16 : 15} className="shrink-0" />
      </button>
      {confirming && (
        <Modal title="Shutdown Rowset?" onClose={() => !busy && setConfirming(false)}>
          <div className="space-y-4">
            <p className="text-[13px] leading-5 text-slate-600 dark:text-slate-300">
              Running queries stop and open transactions are rolled back. Committed changes remain saved.
            </p>
            {error && <p role="alert" className="text-[12px] text-rose-600 dark:text-rose-400">{error}</p>}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={busy}
                className="inline-flex h-8 items-center rounded-md border border-slate-200 bg-white px-3 text-[13px] font-medium text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <Button onClick={shutdown} disabled={busy} className="!bg-rose-600 hover:!bg-rose-500">
                {busy ? "Shutting down…" : "Shutdown"}
              </Button>
            </div>
          </div>
        </Modal>
      )}
      {stopped && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-paper p-6 text-center dark:bg-[#121317]">
          <div className="max-w-sm space-y-2">
            <Icon name="power" size={28} className="mx-auto text-slate-400" />
            <p className="text-[15px] font-semibold text-slate-900 dark:text-slate-100">Rowset Studio is shut down</p>
            <p className="text-[13px] text-slate-500 dark:text-slate-400">You can close this tab. Start Rowset Studio again from the applications menu or with <code>rowset</code>.</p>
          </div>
        </div>
      )}
    </>
  );
}

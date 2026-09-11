import { useHistory } from "./useEditor";

// Recent query history for the active connection. Clicking a row loads its SQL
// back into the editor via onPick.
export default function HistoryPanel({
  connectionId,
  onPick,
}: {
  connectionId: string | null;
  onPick: (sql: string) => void;
}) {
  const { data, isLoading, isError, refetch } = useHistory(connectionId);

  if (!connectionId) return <p className="p-4 text-xs text-slate-500">Select a connection.</p>;
  if (isLoading) return <p className="p-4 text-xs text-slate-500">Loading…</p>;
  if (isError) return <button className="p-4 text-xs text-rose-600" onClick={() => void refetch()}>History unavailable. Retry</button>;
  if (!data || data.length === 0) return <p className="p-4 text-xs text-slate-500">No history yet.</p>;

  return (
    <ul className="divide-y divide-slate-100 text-xs dark:divide-slate-800">
      {data.map((h) => (
        <li key={h.id}>
          <button
            onClick={() => onPick(h.sql)}
            className="block w-full px-3 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-slate-900"
          >
            <div className="flex items-center gap-2">
              <StatusDot status={h.status} />
              <code className="truncate text-slate-800 dark:text-slate-200">{h.sql}</code>
            </div>
            <div className="mt-1 text-slate-500">
              {h.status} · {h.rowsReturned} rows · {h.durationMs}ms
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}

function StatusDot({ status }: { status: string }) {
  const color =
    status === "ok" || status === "success" ? "bg-emerald-400" : status === "blocked" || status === "truncated" ? "bg-amber-400" : "bg-red-400";
  return <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${color}`} />;
}

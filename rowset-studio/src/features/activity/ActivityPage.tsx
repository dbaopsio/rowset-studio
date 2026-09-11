import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { Input, PageHeader, Panel, Select } from "../../components/ui";
import { Icon } from "../../components/Icon";
import EngineLogo from "../../components/EngineLogo";
import { useConnections } from "../connections/useConnections";
import { listMyHistory, type HistoryItem } from "../editor/api";

const RANGES = { "24h": 24 * 60 * 60 * 1000, "7d": 7 * 24 * 60 * 60 * 1000, "30d": 30 * 24 * 60 * 60 * 1000 } as const;
type Range = keyof typeof RANGES;

// Personal activity: the signed-in user's own statements across connections.
export default function ActivityPage() {
  const [range, setRange] = useState<Range>("7d");
  const [connectionId, setConnectionId] = useState("");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const navigate = useNavigate();
  const { data: connections = [] } = useConnections();
  const history = useQuery({
    queryKey: ["my-history", range],
    queryFn: () => listMyHistory({ from: new Date(Date.now() - RANGES[range]).toISOString() }),
  });
  const byId = new Map(connections.map((connection) => [connection.id, connection]));
  const needle = search.trim().toLowerCase();
  const rows = (history.data ?? []).filter((item) =>
    (!connectionId || item.connectionId === connectionId) &&
    (!status || item.status === status) &&
    (!needle || item.sql.toLowerCase().includes(needle)));

  return (
    <div className="space-y-3">
      <PageHeader
        icon="activity"
        title="Activity"
        subtitle="Statements you ran from Rowset Studio, newest first (latest 200). Only you can see your activity."
        actions={
          <button type="button" onClick={() => void history.refetch()} disabled={history.isFetching} title="Refresh" aria-label="Refresh activity" className="grid h-8 w-8 place-items-center rounded-md border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-800 disabled:cursor-wait dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800">
            <Icon name="refresh" size={14} className={history.isFetching ? "animate-spin" : ""} />
          </button>
        }
      />
      <Panel className="flex flex-wrap items-center gap-2 p-2.5">
        <div className="relative min-w-[220px] flex-1">
          <Icon name="search" size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search SQL…" aria-label="Search SQL" className="pl-8" />
        </div>
        <Select aria-label="Connection" value={connectionId} onChange={(event) => setConnectionId(event.target.value)} className="w-52">
          <option value="">All connections</option>
          {connections.map((connection) => <option key={connection.id} value={connection.id}>{connection.name}</option>)}
        </Select>
        <Select aria-label="Status" value={status} onChange={(event) => setStatus(event.target.value)} className="w-36">
          <option value="">All statuses</option>
          <option value="success">Succeeded</option>
          <option value="error">Failed</option>
          <option value="blocked">Blocked by policy</option>
        </Select>
        <Select aria-label="Time range" value={range} onChange={(event) => setRange(event.target.value as Range)} className="w-36">
          <option value="24h">Last 24 hours</option>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
        </Select>
        <span className="ml-auto text-[11px] text-slate-400">{rows.length} of {history.data?.length ?? 0}</span>
      </Panel>
      <Panel className="overflow-hidden">
        {history.isLoading ? (
          <p className="p-6 text-sm text-slate-500">Loading activity…</p>
        ) : history.isError ? (
          <p className="p-6 text-sm text-rose-600">Activity is unavailable. <button className="underline" onClick={() => void history.refetch()}>Retry</button></p>
        ) : rows.length === 0 ? (
          <p className="p-6 text-sm text-slate-500">{history.data?.length ? "No statements match these filters." : "No activity in this period yet. Statements you run in the SQL editor appear here."}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-[13px]">
              <thead className="border-b border-slate-200 bg-slate-50 text-[11px] text-slate-400 dark:border-slate-800 dark:bg-slate-900/40">
                <tr>
                  <th className="px-3 py-2 font-medium">Time</th>
                  <th className="px-3 py-2 font-medium">Connection</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Statement</th>
                  <th className="px-3 py-2 text-right font-medium">Rows</th>
                  <th className="px-3 py-2 text-right font-medium">Duration</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {rows.map((item) => {
                  const connection = item.connectionId ? byId.get(item.connectionId) : undefined;
                  return (
                    <tr key={item.id} className="group hover:bg-slate-50 dark:hover:bg-slate-900/40">
                      <td className="whitespace-nowrap px-3 py-2 text-[12px] text-slate-500" title={item.createdAt}>{formatTime(item.createdAt)}</td>
                      <td className="whitespace-nowrap px-3 py-2">
                        {connection ? (
                          <span className="inline-flex items-center gap-1.5"><EngineLogo engine={connection.engine} size={14} />{connection.name}</span>
                        ) : <span className="text-slate-400">Removed connection</span>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2"><StatusBadge status={item.status} /></td>
                      <td className="max-w-[520px] px-3 py-2"><code className="block truncate font-mono text-[12px] text-slate-700 dark:text-slate-200" title={item.sql}>{item.sql}</code></td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-slate-500">{item.rowsReturned}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-slate-500">{item.durationMs} ms</td>
                      <td className="whitespace-nowrap px-2 py-2">
                        <span className="flex justify-end gap-0.5 opacity-60 group-hover:opacity-100">
                          <RowButton icon="sql" title={connection ? "Open in a new editor tab" : "Open in a new editor tab (connection was removed)"} onClick={() => navigate("/editor", { state: { openSql: item.sql, connectionId: connection ? item.connectionId : null } })} />
                          <CopyButton sql={item.sql} />
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function StatusBadge({ status }: { status: HistoryItem["status"] }) {
  const tone = status === "success" ? "bg-emerald-500" : status === "blocked" ? "bg-amber-500" : status === "error" ? "bg-rose-500" : "bg-slate-400";
  const label = status === "success" ? "Succeeded" : status === "blocked" ? "Blocked" : status === "error" ? "Failed" : status || "Unknown";
  return <span className="inline-flex items-center gap-1.5 text-[12px] text-slate-600 dark:text-slate-300"><span className={`h-1.5 w-1.5 rounded-full ${tone}`} />{label}</span>;
}

function RowButton({ icon, title, onClick, tone }: { icon: "sql" | "copy" | "check"; title: string; onClick: () => void; tone?: string }) {
  return (
    <button type="button" title={title} aria-label={title} onClick={onClick} className={`grid h-6 w-6 place-items-center rounded hover:bg-slate-200 dark:hover:bg-slate-800 ${tone ?? "text-slate-500 hover:text-slate-800 dark:hover:text-slate-100"}`}>
      <Icon name={icon} size={13} />
    </button>
  );
}

function CopyButton({ sql }: { sql: string }) {
  const [copied, setCopied] = useState(false);
  return <RowButton icon={copied ? "check" : "copy"} tone={copied ? "text-emerald-600" : undefined} title={copied ? "Copied" : "Copy SQL"} onClick={() => {
    void navigator.clipboard.writeText(sql).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1500); }, () => undefined);
  }} />;
}

import { useMemo, useState } from "react";
import { EnvBadge } from "../../components/EnvBadge";
import ResultsGrid from "./ResultsGrid";
import SqlCode from "./SqlCode";
import { combineResults, type TargetOutcome, type TargetStatus } from "./multiRun";

export interface MultiRunState {
  outcomes: TargetOutcome[];
  statements: number;
  running: boolean;
}

const statusTone: Record<TargetStatus, string> = {
  queued: "bg-slate-300 dark:bg-slate-600",
  running: "animate-pulse bg-sky-500",
  success: "bg-emerald-500",
  error: "bg-rose-500",
  cancelled: "bg-amber-500",
};

const statusText: Record<TargetStatus, string> = {
  queued: "Waiting",
  running: "Running",
  success: "Done",
  error: "Failed",
  cancelled: "Stopped",
};

// Where a script ran on several connections: one line per connection, and the
// result of the one picked — or every result in one grid when their columns
// match.
export default function MultiRunPanel({ state, onStop }: { state: MultiRunState; onStop: () => void }) {
  const [picked, setPicked] = useState<string | null>(null);
  const [combined, setCombined] = useState(false);
  const merged = useMemo(() => (state.running ? null : combineResults(state.outcomes)), [state]);
  const count = (status: TargetStatus) => state.outcomes.filter((outcome) => outcome.status === status).length;
  const failed = count("error");
  const shown = state.outcomes.find((outcome) => outcome.target.connectionId === picked) ?? state.outcomes.find((outcome) => outcome.status === "error") ?? state.outcomes[0];
  const showCombined = combined && merged;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-8 shrink-0 items-center gap-3 border-b border-slate-200 px-3 text-[12px] text-slate-600 dark:border-slate-800 dark:text-slate-300">
        <span>
          {state.outcomes.length} connections · {count("success")} done
          {failed > 0 && <span className="text-rose-600 dark:text-rose-400"> · {failed} failed</span>}
          {count("cancelled") > 0 && <span className="text-amber-600 dark:text-amber-400"> · {count("cancelled")} stopped</span>}
          {state.running && ` · ${count("running")} running · ${count("queued")} waiting`}
        </span>
        {state.running && (
          <button type="button" onClick={onStop} className="h-6 rounded border border-rose-300 px-2 text-[11.5px] text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950">Stop all</button>
        )}
        {merged && (
          <label className="ml-auto flex items-center gap-1.5" title="Every result in one grid, with the connection in the first column">
            <input type="checkbox" checked={combined} onChange={(event) => setCombined(event.target.checked)} />
            Combine results
          </label>
        )}
      </div>

      <div className="flex min-h-0 flex-1">
      {!showCombined && (
        // Beside the result rather than above it: the panel is short and wide,
        // and every connection should stay in view while one result is read.
        <div className="w-[26rem] max-w-[45%] shrink-0 overflow-auto border-r border-slate-200 dark:border-slate-800">
          <table className="w-full text-left text-[12px]">
            <thead className="sticky top-0 bg-slate-50 text-[11px] text-slate-500 dark:bg-slate-900 dark:text-slate-400">
              <tr>
                <th className="w-full px-3 py-1 font-medium">Connection</th>
                <th className="px-2 py-1 font-medium">Status</th>
                <th className="px-2 py-1 text-right font-medium" title="Statements that succeeded, of all of them">Stmts</th>
                <th className="px-2 py-1 text-right font-medium">Rows</th>
                <th className="px-2 py-1 pr-3 text-right font-medium">Time</th>
              </tr>
            </thead>
            <tbody>
              {state.outcomes.map((outcome) => {
                const active = outcome === shown;
                return (
                  <tr
                    key={outcome.target.connectionId}
                    onClick={() => setPicked(outcome.target.connectionId)}
                    className={`cursor-pointer border-t border-slate-100 dark:border-slate-900 ${active ? "bg-sky-50 dark:bg-sky-500/10" : "hover:bg-slate-50 dark:hover:bg-slate-900"}`}
                  >
                    <td className="max-w-0 px-3 py-1" title={`${outcome.target.name} · ${outcome.target.database || "default database"}`}>
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate font-medium text-slate-800 dark:text-slate-100">{outcome.target.name}</span>
                        <EnvBadge env={outcome.target.environment} />
                      </span>
                    </td>
                    <td className="px-2 py-1">
                      <span className="flex items-center gap-1.5 whitespace-nowrap">
                        <span className={`h-2 w-2 shrink-0 rounded-full ${statusTone[outcome.status]}`} />
                        {statusText[outcome.status]}
                      </span>
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums">{outcome.completed}/{outcome.total}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{outcome.rowCount ?? "—"}</td>
                    <td className="whitespace-nowrap px-2 py-1 pr-3 text-right tabular-nums text-slate-500">{duration(outcome)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        {showCombined ? (
          <ResultsGrid result={merged} />
        ) : shown && (shown.status === "error" || shown.status === "cancelled") && shown.error ? (
          <div className="space-y-2 p-3 text-[12.5px]">
            <p className={`whitespace-pre-wrap ${shown.status === "error" ? "text-rose-700 dark:text-rose-300" : "text-amber-700 dark:text-amber-300"}`}>
              {shown.target.name}{shown.target.database ? ` (${shown.target.database})` : ""}: {shown.error}
            </p>
            {shown.failedStatement && <SqlCode sql={shown.failedStatement} className="rounded-md border border-slate-200 bg-slate-50 p-2.5 dark:border-slate-800 dark:bg-slate-900" />}
            {shown.completed > 0 && <p className="text-slate-500">{shown.completed} statement(s) before it succeeded and were committed.</p>}
          </div>
        ) : shown?.result ? (
          <ResultsGrid result={shown.result} />
        ) : (
          <p className="p-3 text-[12.5px] text-slate-500">
            {shown?.status === "success" ? `${shown.target.name}: done${shown.rowCount !== undefined ? `, ${shown.rowCount} row(s)` : ""}.` : "Results appear here as each connection finishes."}
          </p>
        )}
      </div>
      </div>
    </div>
  );
}

function duration(outcome: TargetOutcome) {
  if (!outcome.startedAt) return "—";
  const ms = (outcome.endedAt ?? Date.now()) - outcome.startedAt;
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

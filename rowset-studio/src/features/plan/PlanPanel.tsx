import { useEffect, useRef, useState } from "react";
import PolicyBanner from "../editor/PolicyBanner";
import type { PlanResult } from "../editor/api";
import { parsePlanFor, renderPlan } from "./executionflow/index.js";
import "./plan.css";

export interface PlanState {
  status: "loading" | "ready" | "error";
  sql: string;
  analyze: boolean;
  result?: PlanResult;
  error?: Error;
}

// Draws the execution plan of the last explained statement in a tab.
export default function PlanPanel({ plan }: { plan?: PlanState }) {
  const container = useRef<HTMLDivElement>(null);
  const [parseError, setParseError] = useState("");

  useEffect(() => {
    const node = container.current;
    if (!node) return;
    node.replaceChildren();
    setParseError("");
    if (plan?.status !== "ready" || !plan.result) return;
    const parsed = parsePlanFor(plan.result.engine, plan.result.plan);
    if (!parsed.ok) {
      setParseError(parsed.error ?? "Could not read the execution plan.");
      return;
    }
    // The statement is shown above the plan, so the renderer's copy is hidden.
    const single = parsed.statements.length === 1;
    parsed.statements.forEach((statement, index) => node.appendChild(renderPlan(statement, index, { single, hideText: true })));
  }, [plan]);

  if (!plan) {
    return (
      <div className="p-6 text-center text-[13px] text-slate-500 dark:text-slate-400">
        <p className="font-medium text-slate-700 dark:text-slate-200">No plan yet</p>
        <p className="mt-1">Explain shows how the database will run the statement under the cursor, without running it.</p>
      </div>
    );
  }
  return (
    <div className="space-y-3 p-3">
      <div className="flex flex-wrap items-center gap-2 text-[12px] text-slate-500 dark:text-slate-400">
        <span className={`rounded px-1.5 py-0.5 font-medium ${plan.analyze ? "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300" : "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300"}`}>
          {plan.analyze ? "Actual plan · the statement ran" : "Estimated plan"}
        </span>
        <code className="min-w-0 flex-1 truncate font-mono text-[11px]" title={plan.sql}>{plan.sql}</code>
      </div>
      {plan.status === "loading" && <p className="text-[13px] text-slate-500">Getting the plan…</p>}
      {plan.status === "error" && <PolicyBanner error={plan.error} />}
      {parseError && <p role="alert" className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">{parseError}</p>}
      <div ref={container} className="ef" />
    </div>
  );
}

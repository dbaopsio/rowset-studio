import { ApiError } from "../../lib/api";
import { Icon } from "../../components/Icon";
import { useActiveExtensions, type DenialContext } from "../../app/extensions";

// Surfaces query failures. When the error carries policy metadata (SQL
// firewall denials), it renders the policy name and risk prominently.
export default function PolicyBanner({ error, context }: { error: unknown; context?: DenialContext }) {
  const actions = useActiveExtensions().flatMap((item) => item.denialActions ?? []);
  if (!error) return null;
  const { message, policy, risk } = normalize(error);
  const diagnostic = error instanceof ApiError ? error.body : undefined;
  if (diagnostic?.code === "PENDING") return (
    <div role="status" className="m-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-[13px] text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
      {message}
    </div>
  );

  return (
    <div className="m-3 flex gap-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 dark:border-rose-500/30 dark:bg-rose-500/10">
      <Icon name="alert" size={16} className="mt-0.5 text-rose-500 dark:text-rose-400" />
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium text-rose-700 dark:text-rose-300">{message}</div>
        {diagnostic && <div className="mt-1 text-xs text-rose-700 dark:text-rose-300">
          {diagnostic.sqlstate && `SQLSTATE ${diagnostic.sqlstate} `}
          {diagnostic.number && `Error ${diagnostic.number} `}
          {diagnostic.line && `Line ${diagnostic.line}${diagnostic.column ? `, column ${diagnostic.column}` : ""} (executed SQL)`}
        </div>}
        {(policy || risk) && (
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
            {policy && (
              <span className="rounded border border-rose-200 bg-white px-1.5 py-0.5 font-mono text-rose-600 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
                {policy}
              </span>
            )}
            {risk && (
              <span className="rounded border border-rose-300 bg-rose-100 px-1.5 py-0.5 font-medium capitalize text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/20 dark:text-rose-200">
                {risk} risk
              </span>
            )}
          </div>
        )}
        {context && actions.map((Action, index) => <Action key={index} error={error} context={context} />)}
      </div>
    </div>
  );
}

function normalize(error: unknown): { message: string; policy?: string; risk?: string } {
  if (error instanceof ApiError) {
    return { message: error.body.message, policy: error.body.policy, risk: error.body.risk };
  }
  if (error instanceof Error) return { message: error.message };
  return { message: "Query failed" };
}

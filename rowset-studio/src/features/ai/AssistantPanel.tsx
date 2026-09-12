import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { Icon } from "../../components/Icon";
import SqlCode from "../editor/SqlCode";
import { askAi, getAiSettings, type AiTask } from "./api";

const TASKS: { task: AiTask; label: string; hint: string }[] = [
  { task: "write", label: "Write a statement", hint: "Describe what you need; the assistant writes it from your schema" },
  { task: "explain", label: "Explain this", hint: "What the statement in the editor does" },
  { task: "optimize", label: "Make it faster", hint: "Rewrite it using the indexes that exist" },
  { task: "indexes", label: "Suggest an index", hint: "Which index would help this statement" },
];

// Asks the assistant about the statement in the editor. Answers arrive as
// text with SQL blocks; a statement can be put straight into the editor.
export default function AssistantPanel({
  sql,
  connectionId,
  database,
  error,
  plan,
  onInsert,
}: {
  sql: string;
  connectionId: string | null;
  database?: string;
  /** Message of the last failed run, so its cause can be asked about. */
  error?: string;
  plan?: string;
  onInsert: (sql: string) => void;
}) {
  const settings = useQuery({ queryKey: ["ai-settings"], queryFn: getAiSettings });
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<{ text: string; sql: string; sharedSchema: boolean } | null>(null);
  const [asking, setAsking] = useState<AiTask | "">("");
  const [failure, setFailure] = useState("");

  // A new statement makes the previous answer stale.
  useEffect(() => setAnswer(null), [sql]);

  async function ask(task: AiTask) {
    setAsking(task);
    setFailure("");
    try {
      const result = await askAi({ connectionId, database, task, question, sql, error: task === "fix" ? error : "", plan: task === "optimize" || task === "indexes" ? plan : "" });
      setAnswer({ text: result.answer, sql: result.sql, sharedSchema: result.sharedSchema });
    } catch (err) {
      setFailure(err instanceof Error ? err.message : "The assistant did not answer.");
    } finally {
      setAsking("");
    }
  }

  if (settings.isLoading) return <p className="p-4 text-[13px] text-slate-500">Loading the assistant…</p>;
  if (!settings.data || settings.data.provider === "none") {
    return (
      <div className="p-4 text-[13px] text-slate-500 dark:text-slate-400">
        <p className="font-medium text-slate-700 dark:text-slate-200">No assistant set up</p>
        <p className="mt-1 max-w-xl">
          Choose your own Anthropic or OpenAI key, or a <code>claude</code> / <code>codex</code> command already signed in on this computer, in{" "}
          <Link to="/account" className="underline">Account</Link>.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3 p-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {TASKS.map((item) => (
          <button
            key={item.task}
            type="button"
            title={item.hint}
            disabled={Boolean(asking) || (item.task !== "write" && !sql.trim())}
            onClick={() => void ask(item.task)}
            className="inline-flex h-7 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-[12px] text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <Icon name="wand" size={12} className="text-slate-400" />
            {asking === item.task ? "Asking…" : item.label}
          </button>
        ))}
        {error && (
          <button
            type="button"
            title="Explain the error of the last run and correct the statement"
            disabled={Boolean(asking)}
            onClick={() => void ask("fix")}
            className="inline-flex h-7 items-center gap-1.5 rounded-md border border-rose-200 bg-rose-50 px-2.5 text-[12px] font-medium text-rose-700 transition hover:bg-rose-100 disabled:opacity-50 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300"
          >
            <Icon name="alert" size={12} />
            {asking === "fix" ? "Asking…" : "Why did this fail?"}
          </button>
        )}
      </div>
      <input
        value={question}
        onChange={(event) => setQuestion(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Enter" && question.trim()) void ask("write"); }}
        placeholder="What do you need? For example: last 5 days of sales per customer"
        aria-label="What do you need"
        className="h-8 w-full rounded-md border border-slate-200 bg-white px-2.5 text-[12.5px] text-slate-700 outline-none placeholder:text-slate-400 focus:border-slate-400 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200"
      />
      {failure && <p role="alert" className="text-[12px] text-rose-600 dark:text-rose-400">{failure}</p>}
      {answer && (
        <div className="space-y-2">
          <p className="whitespace-pre-wrap text-[13px] leading-5 text-slate-700 dark:text-slate-200">{withoutSqlBlocks(answer.text)}</p>
          {answer.sql && (
            <div className="space-y-2">
              <SqlCode sql={answer.sql} className="rounded-md border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900" />
              <button type="button" onClick={() => onInsert(answer.sql)} className="inline-flex h-7 items-center gap-1.5 rounded-md bg-emerald-600 px-2.5 text-[12px] font-medium text-white hover:bg-emerald-500">
                <Icon name="sql" size={12} />
                Put in a new tab
              </button>
            </div>
          )}
          <p className="text-[11px] text-slate-400">
            {answer.sharedSchema ? "Answered with your table and column names as context; no table contents were sent." : "Answered without your schema."}
            {" "}Check a statement before running it.
          </p>
        </div>
      )}
    </div>
  );
}

// The SQL of an answer is shown on its own, coloured, so it is dropped from
// the prose above it.
function withoutSqlBlocks(text: string) {
  return text.replace(/```sql[\s\S]*?```/gi, "").replace(/```[\s\S]*?```/g, "").replace(/\n{3,}/g, "\n\n").trim();
}

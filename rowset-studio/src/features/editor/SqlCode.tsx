import { sqlTokens } from "./sqlText";

const KEYWORDS = new Set([
  "add", "all", "alter", "and", "as", "asc", "begin", "between", "by", "call", "cascade", "case", "cast", "check",
  "collate", "column", "commit", "constraint", "create", "cross", "cycle", "declare", "default", "deferrable",
  "delete", "desc", "distinct", "do", "drop", "else", "end", "exec", "execute", "exists", "false", "for", "foreign",
  "from", "full", "function", "generated", "grant", "group", "having", "identity", "if", "in", "increment", "index",
  "inner", "insert", "into", "is", "join", "key", "language", "left", "like", "limit", "maxvalue", "minvalue", "not",
  "null", "nulls", "offset", "on", "or", "order", "outer", "primary", "procedure", "references", "replace", "return",
  "returns", "returning", "right", "rollback", "row", "rows", "schema", "select", "sequence", "set", "start", "stored",
  "table", "then", "top", "trigger", "true", "union", "unique", "update", "using", "values", "view", "when", "where",
  "while", "with",
]);

const CLASSES: Record<string, string> = {
  keyword: "font-medium text-indigo-700 dark:text-indigo-300",
  string: "text-emerald-700 dark:text-emerald-300",
  number: "text-amber-700 dark:text-amber-300",
  comment: "italic text-slate-400 dark:text-slate-500",
  plain: "",
};

// Colours SQL for read-only views such as the DDL of an object. The editor
// itself uses Monaco; this is for the places that only show SQL.
export default function SqlCode({ sql, className = "" }: { sql: string; className?: string }) {
  return (
    <pre className={`overflow-auto whitespace-pre font-mono text-[12px] leading-5 text-slate-700 dark:text-slate-200 ${className}`}>
      <code>
        {sqlTokens(sql).map((token, index) => {
          const kind =
            token.kind === "comment" ? "comment"
            : token.kind === "quoted" ? (token.text.startsWith("'") || token.text.startsWith("$") ? "string" : "plain")
            : token.kind === "word" ? (KEYWORDS.has(token.text.toLowerCase()) ? "keyword" : /^[\d.]+$/.test(token.text) ? "number" : "plain")
            : "plain";
          return kind === "plain" ? token.text : <span key={index} className={CLASSES[kind]}>{token.text}</span>;
        })}
      </code>
    </pre>
  );
}

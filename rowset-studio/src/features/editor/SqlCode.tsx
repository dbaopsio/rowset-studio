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

// The same colours the editor's own theme uses, so SQL reads the same
// wherever it is shown.
const CLASSES: Record<string, string> = {
  keyword: "font-semibold text-[#a8482a] dark:text-[#e0a526]",
  string: "text-[#7a6a15] dark:text-[#c9b458]",
  number: "text-[#3e7a3a] dark:text-[#8fbf6f]",
  comment: "italic text-[#a9a08d] dark:text-[#7c7362]",
  plain: "",
};

// Colours SQL for read-only views such as the DDL of an object. The editor
// itself uses Monaco; this is for the places that only show SQL.
export default function SqlCode({ sql, className = "" }: { sql: string; className?: string }) {
  return (
    <pre className={`overflow-auto whitespace-pre font-mono text-[12px] leading-5 text-[#1d1b16] dark:text-[#ece7dc] ${className}`}>
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

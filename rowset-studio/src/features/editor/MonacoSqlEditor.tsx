import { useEffect, useRef, useState } from "react";
import Editor, { type Monaco } from "@monaco-editor/react";
import { ROWSET_SQL_LANGUAGE, defineThemes } from "./monacoSetup";
import { aliasMap, clauseAt, columnSuggestions, dotSuggestions, groupByColumns, joinSuggestions, type SqlCompletions } from "./sqlCompletions";
import { splitStatements } from "./sqlText";
import { inspectSql, type Inspection } from "./sqlInspections";

// Warm SQL themes matched to the app palette (terracotta/ink on paper) so the
// editor reads as one surface with the rest of the product — no cool default blue.
const SQL_KEYWORDS = [
  "SELECT", "FROM", "WHERE", "INSERT INTO", "UPDATE", "DELETE FROM", "SET", "VALUES",
  "JOIN", "LEFT JOIN", "RIGHT JOIN", "INNER JOIN", "ON", "GROUP BY", "ORDER BY", "HAVING",
  "LIMIT", "OFFSET", "DISTINCT", "AS", "AND", "OR", "NOT", "NULL", "IS NULL", "IN",
  "LIKE", "BETWEEN", "COUNT", "SUM", "AVG", "MIN", "MAX", "ASC", "DESC", "UNION",
  "CASE", "WHEN", "THEN", "ELSE", "END", "WITH",
];

// Live schema for autocomplete. A single global provider reads this ref so we
// don't register a duplicate provider on every mount/connection change.
const schemaRef: { current: SqlCompletions } = {
  current: { tableColumns: {}, tableNames: {}, schemaTables: {}, schemaNames: {}, routines: [] },
};
let providerRegistered = false;

// FROM/JOIN/UPDATE/INTO targets with optional aliases, e.g.
// "from accounts a join customers as c" -> { a: accounts, c: customers }.
// Bare table names also map to themselves so "accounts." completes columns.
function registerCompletion(monaco: Monaco) {
  if (providerRegistered) return;
  providerRegistered = true;
  monaco.languages.registerCompletionItemProvider(ROWSET_SQL_LANGUAGE, {
    triggerCharacters: [" ", ".", "("],
    provideCompletionItems: (model, position) => {
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };
      const K = monaco.languages.CompletionItemKind;
      const { tableColumns, tableNames, schemaNames, routines, databaseNames = {} } = schemaRef.current;
      const fullText = model.getValue();
      const aliases = aliasMap(fullText);

      // Dot context: "<ident>." before the word being typed. Suggest only what
      // that identifier can own — alias/table columns, or a schema's tables.
      const lineBefore = model.getLineContent(position.lineNumber).slice(0, word.startColumn - 1);
      const dotMatch = lineBefore.match(/(["`[]?[\w$]+["`\]]?)\.$/);
      if (dotMatch) {
        const ident = dotMatch[1].replace(/^["`[]|["`\]]$/g, "").toLowerCase();
        const resolved = dotSuggestions(fullText, ident, schemaRef.current);
        if (resolved.values.length > 0 && resolved.kind === "column") {
          return {
            suggestions: resolved.values.map((c) => ({
              label: { label: c, description: "column" }, kind: K.Field, insertText: c, range, detail: resolved.owner, sortText: "0" + c,
            })),
          };
        }
        if (resolved.values.length > 0 && resolved.kind === "schema") {
          return {
            suggestions: resolved.values.map((name) => ({
              label: { label: name, description: "schema" }, kind: K.Module, insertText: name, range, sortText: "0" + name,
            })),
          };
        }
        if (resolved.values.length > 0 && resolved.kind === "table") {
          return {
            suggestions: resolved.values.map((t) => ({
              label: { label: t, description: "table" }, kind: K.Struct, insertText: t, range, sortText: "0" + t,
            })),
          };
        }
        return { suggestions: [] };
      }

      // Plain context. What ranks first follows the clause the cursor is in:
      // columns while selecting or filtering, tables after FROM and JOIN.
      const clause = clauseAt(fullText, model.getOffsetAt(position), schemaRef.current.engine);
      const wantsTables = clause === "from";
      const columnRank = wantsTables ? "2" : "0";
      const tableRank = wantsTables ? "0" : "1";
      const referenced = new Set(Object.values(aliases).map((table) => table.toLowerCase()));
      // Columns of the tables in the statement, qualified where the bare name
      // would not resolve on its own.
      const local = columnSuggestions(fullText, schemaRef.current);
      const localColumns = new Set(local.map((item) => item.label));
      const otherColumns = new Set<string>();
      for (const [t, cols] of Object.entries(tableColumns)) {
        if (!referenced.has(t)) for (const c of cols) otherColumns.add(c);
      }
      for (const c of localColumns) otherColumns.delete(c);
      for (const item of local) otherColumns.delete(item.insertText);

      const suggestions = [
        // A join the foreign keys allow, with its ON clause already written.
        ...(wantsTables ? joinSuggestions(fullText, schemaRef.current) : []).map((join) => ({
          label: { label: join.label, description: "join" },
          kind: K.Snippet,
          insertText: join.insertText,
          detail: join.detail,
          range,
          sortText: "0" + join.label,
        })),
        ...local.map((item) => ({
          label: { label: item.label, description: "column" },
          kind: K.Field,
          insertText: item.insertText,
          detail: item.detail,
          range,
          // A qualified name that is the only way to reach the column ranks
          // with the plain ones; the rest sit just behind them.
          sortText: columnRank + (item.qualifiedOnly || !item.label.includes(".") ? "" : "~") + item.label,
        })),
        ...Object.entries(schemaNames).map(([key, name]) => ({ label: { label: name, description: "schema" }, kind: K.Module, insertText: name, range, sortText: "1" + key })),
        ...Object.entries(databaseNames).map(([key, name]) => ({ label: { label: name, description: "database" }, kind: K.Module, insertText: name, range, sortText: "1" + key })),
        ...Object.keys(tableColumns).map((t) => {
          const name = tableNames[t] ?? t;
          return { label: { label: name, description: "table" }, kind: K.Struct, insertText: name, range, sortText: tableRank + name };
        }),
        ...SQL_KEYWORDS.map((k) => ({ label: { label: k, description: "keyword" }, kind: K.Keyword, insertText: k, range, sortText: "2" + k })),
        ...routines.map((r) => ({ label: { label: r.name, description: r.kind }, kind: K.Function, insertText: r.name, range, sortText: "3" + r.name })),
        ...[...otherColumns].map((c) => ({ label: { label: c, description: "column" }, kind: K.Field, insertText: c, range, sortText: (wantsTables ? "4" : "3") + c })),
      ];
      return { suggestions };
    },
  });
}

let actionsRegistered = false;

// The last inspection of each editor model, so a quick fix can find the fixes
// behind the marker it was asked about.
const inspections = new Map<string, Inspection[]>();
const MARKER_OWNER = "rowset";

function inspect(monaco: Monaco, model: ReturnType<Monaco["editor"]["createModel"]>) {
  if (model.isDisposed()) return;
  const found = inspectSql(model.getValue(), schemaRef.current);
  inspections.set(model.uri.toString(), found);
  monaco.editor.setModelMarkers(model, MARKER_OWNER, found.map((item) => {
    const start = model.getPositionAt(item.start);
    const end = model.getPositionAt(item.end);
    return {
      startLineNumber: start.lineNumber,
      startColumn: start.column,
      endLineNumber: end.lineNumber,
      endColumn: end.column,
      message: item.message,
      severity: item.severity === "error" ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning,
      code: item.code,
      source: "Rowset",
    };
  }));
}

// Quick fixes: the ones inspections offer for the marker under the cursor,
// and GROUP BY for a SELECT that aggregates without one.
function registerCodeActions(monaco: Monaco) {
  if (actionsRegistered) return;
  actionsRegistered = true;
  monaco.languages.registerCodeActionProvider(ROWSET_SQL_LANGUAGE, {
    provideCodeActions: (model, range, context) => {
      const actions: { title: string; kind: string; isPreferred?: boolean; diagnostics?: typeof context.markers; edit: { edits: { resource: typeof model.uri; versionId: number; textEdit: { range: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number }; text: string } }[] } }[] = [];
      const known = inspections.get(model.uri.toString()) ?? [];
      for (const marker of context.markers) {
        if (marker.source !== "Rowset") continue;
        const start = model.getOffsetAt({ lineNumber: marker.startLineNumber, column: marker.startColumn });
        const end = model.getOffsetAt({ lineNumber: marker.endLineNumber, column: marker.endColumn });
        const item = known.find((candidate) => candidate.start === start && candidate.end === end && candidate.code === marker.code);
        item?.fixes.forEach((fix, index) => {
          const from = model.getPositionAt(fix.start);
          const to = model.getPositionAt(fix.end);
          actions.push({
            title: fix.title,
            kind: "quickfix",
            isPreferred: item.fixes.length === 1 && index === 0,
            diagnostics: [marker],
            edit: { edits: [{ resource: model.uri, versionId: model.getVersionId(), textEdit: { range: { startLineNumber: from.lineNumber, startColumn: from.column, endLineNumber: to.lineNumber, endColumn: to.column }, text: fix.replacement } }] },
          });
        });
      }
      const groupBy = groupByAction(model, range);
      if (groupBy) actions.push(groupBy);
      return { actions, dispose: () => undefined };
    },
  });
}

// A SELECT that aggregates without a GROUP BY gets the columns it must group by.
function groupByAction(model: ReturnType<Monaco["editor"]["createModel"]>, range: { startLineNumber: number; startColumn: number }) {
  const text = model.getValue();
  const engine = schemaRef.current.engine;
  const offset = model.getOffsetAt({ lineNumber: range.startLineNumber, column: range.startColumn });
  const statement = splitStatements(text, engine).find((item) => offset >= item.start && offset <= item.end);
  if (!statement) return null;
  const body = statement.sql;
  if (/\bgroup\s+by\b/i.test(body)) return null;
  if (!/^\s*select\b/i.test(body)) return null;
  if (!/\b(count|sum|avg|min|max|array_agg|string_agg|group_concat|listagg)\s*\(/i.test(body)) return null;
  const columns = groupByColumns(body, engine);
  if (columns.length === 0) return null;
  // GROUP BY belongs before whatever closes the statement. The statement's
  // text is trimmed, so its position is found again in the editor.
  const tail = body.search(/\b(order\s+by|limit|fetch\s+first|for\s+update)\b/i);
  const cut = tail >= 0 ? tail : body.replace(/[\s;]+$/, "").length;
  const bodyStart = text.indexOf(body, statement.start);
  const at = model.getPositionAt((bodyStart >= 0 ? bodyStart : statement.start) + cut);
  const newline = tail >= 0 ? "" : "\n";
  return {
    title: `Group by ${columns.join(", ")}`,
    kind: "quickfix",
    edit: { edits: [{ resource: model.uri, versionId: model.getVersionId(), textEdit: { range: { startLineNumber: at.lineNumber, startColumn: at.column, endLineNumber: at.lineNumber, endColumn: at.column }, text: `${newline}GROUP BY ${columns.join(", ")}${tail >= 0 ? "\n" : ""}` } }] },
  };
}

// Thin Monaco wrapper fixed to the SQL language. Autocomplete is fed by the
// current connection's schema (tables + columns) plus SQL keywords.
export default function MonacoSqlEditor({
  value,
  onChange,
  onSelectionChange,
  onCursorChange,
  onRun,
  onRunAll,
  completions,
}: {
  value: string;
  onChange: (v: string) => void;
  onSelectionChange?: (selectedText: string) => void;
  onCursorChange?: (pos: { line: number; column: number }) => void;
  onRun?: () => void;
  onRunAll?: () => void;
  completions?: SqlCompletions;
}) {
  // Latest handlers, so the editor keybindings never call a stale closure.
  const onRunRef = useRef(onRun);
  onRunRef.current = onRun;
  const onRunAllRef = useRef(onRunAll);
  onRunAllRef.current = onRunAll;
  // Re-inspects the text when the schema behind the checks changes.
  const reinspect = useRef<(() => void) | null>(null);
  const [theme, setTheme] = useState(() => (document.documentElement.classList.contains("dark") ? "dark" : "light"));

  useEffect(() => {
    const onTheme = (event: Event) => setTheme((event as CustomEvent<string>).detail);
    window.addEventListener("rowset:theme", onTheme);
    return () => window.removeEventListener("rowset:theme", onTheme);
  }, []);

  useEffect(() => {
    schemaRef.current = completions ?? { tableColumns: {}, tableNames: {}, schemaTables: {}, schemaNames: {}, routines: [] };
    reinspect.current?.();
  }, [completions]);

  return (
    <Editor
      height="100%"
      defaultLanguage={ROWSET_SQL_LANGUAGE}
      theme={theme === "light" ? "rowset-light" : "rowset-dark"}
      value={value}
      beforeMount={(monaco) => { defineThemes(monaco); registerCompletion(monaco); registerCodeActions(monaco); }}
      onChange={(v) => onChange(v ?? "")}
      onMount={(editor, monaco) => {
        // Cmd/Ctrl+Enter runs the selection (or the whole statement).
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
          onRunRef.current?.();
        });
        // Shift+Cmd/Ctrl+Enter runs every statement in the editor.
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Enter, () => {
          onRunAllRef.current?.();
        });
        editor.onDidChangeCursorSelection((e) => {
          const model = editor.getModel();
          onSelectionChange?.(model ? model.getValueInRange(e.selection) : "");
        });
        editor.onDidChangeCursorPosition((e) => {
          onCursorChange?.({ line: e.position.lineNumber, column: e.position.column });
        });
        // Problems are marked once typing pauses, not on every keystroke.
        let timer: number | undefined;
        const check = () => {
          const model = editor.getModel();
          if (model) inspect(monaco, model);
        };
        reinspect.current = check;
        check();
        const typing = editor.onDidChangeModelContent(() => {
          window.clearTimeout(timer);
          timer = window.setTimeout(check, 300);
        });
        editor.onDidDispose(() => {
          window.clearTimeout(timer);
          typing.dispose();
          reinspect.current = null;
          const model = editor.getModel();
          if (model) inspections.delete(model.uri.toString());
        });
      }}
      options={{
        quickSuggestions: true,
        suggestOnTriggerCharacters: true,
        wordBasedSuggestions: "off",
        fontSize: 13,
        lineHeight: 20,
        fontFamily: "JetBrains Mono, IBM Plex Mono, Menlo, Monaco, Consolas, monospace",
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        automaticLayout: true,
        renderLineHighlight: "line",
        overviewRulerBorder: false,
        padding: { top: 8, bottom: 8 },
      }}
    />
  );
}

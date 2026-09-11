import { useEffect, useRef, useState } from "react";
import Editor, { type Monaco } from "@monaco-editor/react";
import { ROWSET_SQL_LANGUAGE } from "./monacoSetup";
import { aliasMap, dotSuggestions, type SqlCompletions } from "./sqlCompletions";

// Warm SQL themes matched to the app palette (terracotta/ink on paper) so the
// editor reads as one surface with the rest of the product — no cool default blue.
function defineThemes(monaco: Monaco) {
  monaco.editor.defineTheme("rowset-light", {
    base: "vs",
    inherit: true,
    rules: [
      { token: "keyword.sql", foreground: "a8482a", fontStyle: "bold" },
      { token: "keyword", foreground: "a8482a", fontStyle: "bold" },
      { token: "operator.sql", foreground: "8c3a22" },
      { token: "string.sql", foreground: "7a6a15" },
      { token: "string", foreground: "7a6a15" },
      { token: "number", foreground: "3e7a3a" },
      { token: "comment", foreground: "a9a08d", fontStyle: "italic" },
      { token: "predefined.sql", foreground: "5c5446" },
      { token: "identifier", foreground: "1d1b16" },
    ],
    colors: {
      "editor.background": "#ffffff",
      "editor.foreground": "#1d1b16",
      "editorLineNumber.foreground": "#a9a08d",
      "editorLineNumber.activeForeground": "#5c5446",
      "editor.selectionBackground": "#e6bfa855",
      "editor.lineHighlightBackground": "#faf1eb",
      "editorCursor.foreground": "#a8482a",
    },
  });
  monaco.editor.defineTheme("rowset-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "keyword.sql", foreground: "e0a526", fontStyle: "bold" },
      { token: "keyword", foreground: "e0a526", fontStyle: "bold" },
      { token: "operator.sql", foreground: "d89b79" },
      { token: "string.sql", foreground: "c9b458" },
      { token: "string", foreground: "c9b458" },
      { token: "number", foreground: "8fbf6f" },
      { token: "comment", foreground: "7c7362", fontStyle: "italic" },
      { token: "identifier", foreground: "ece7dc" },
    ],
    colors: {
      "editor.background": "#121317",
      "editor.foreground": "#e7e9ec",
      "editorLineNumber.foreground": "#5c5446",
      "editor.lineHighlightBackground": "#1e1b15",
      "editorCursor.foreground": "#e0a526",
    },
  });
}

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
      const { tableColumns, tableNames, schemaNames, routines } = schemaRef.current;
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
        if (resolved.values.length > 0 && resolved.kind === "table") {
          return {
            suggestions: resolved.values.map((t) => ({
              label: { label: t, description: "table" }, kind: K.Struct, insertText: t, range, sortText: "0" + t,
            })),
          };
        }
        return { suggestions: [] };
      }

      // Plain context. Columns of tables already referenced in the statement
      // rank first; every table name next; other columns after keywords.
      const referenced = new Set(Object.values(aliases).map((table) => table.toLowerCase()));
      const localColumns = new Set<string>();
      for (const t of referenced) for (const c of tableColumns[t] ?? []) localColumns.add(c);
      const otherColumns = new Set<string>();
      for (const [t, cols] of Object.entries(tableColumns)) {
        if (!referenced.has(t)) for (const c of cols) otherColumns.add(c);
      }
      for (const c of localColumns) otherColumns.delete(c);

      const suggestions = [
        ...[...localColumns].map((c) => ({ label: { label: c, description: "column" }, kind: K.Field, insertText: c, range, sortText: "0" + c })),
        ...Object.entries(schemaNames).map(([key, name]) => ({ label: { label: name, description: "schema" }, kind: K.Module, insertText: name, range, sortText: "1" + key })),
        ...Object.keys(tableColumns).map((t) => {
          const name = tableNames[t] ?? t;
          return { label: { label: name, description: "table" }, kind: K.Struct, insertText: name, range, sortText: "1" + name };
        }),
        ...SQL_KEYWORDS.map((k) => ({ label: { label: k, description: "keyword" }, kind: K.Keyword, insertText: k, range, sortText: "2" + k })),
        ...routines.map((r) => ({ label: { label: r.name, description: r.kind }, kind: K.Function, insertText: r.name, range, sortText: "3" + r.name })),
        ...[...otherColumns].map((c) => ({ label: { label: c, description: "column" }, kind: K.Field, insertText: c, range, sortText: "4" + c })),
      ];
      return { suggestions };
    },
  });
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
  const [theme, setTheme] = useState(() => (document.documentElement.classList.contains("dark") ? "dark" : "light"));

  useEffect(() => {
    const onTheme = (event: Event) => setTheme((event as CustomEvent<string>).detail);
    window.addEventListener("rowset:theme", onTheme);
    return () => window.removeEventListener("rowset:theme", onTheme);
  }, []);

  useEffect(() => {
    schemaRef.current = completions ?? { tableColumns: {}, tableNames: {}, schemaTables: {}, schemaNames: {}, routines: [] };
  }, [completions]);

  return (
    <Editor
      height="100%"
      defaultLanguage={ROWSET_SQL_LANGUAGE}
      theme={theme === "light" ? "rowset-light" : "rowset-dark"}
      value={value}
      beforeMount={(monaco) => { defineThemes(monaco); registerCompletion(monaco); }}
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

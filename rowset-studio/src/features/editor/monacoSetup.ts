import { loader } from "@monaco-editor/react";
// Keep every editor contribution (including the suggest widget), but register
// only SQL instead of shipping Monaco's complete language catalog and the
// CSS/HTML/JSON/TypeScript language services.
import "monaco-editor/esm/vs/editor/editor.all.js";
import { conf as sqlConfiguration, language as sqlLanguage } from "monaco-editor/esm/vs/basic-languages/sql/sql.js";
import * as monaco from "monaco-editor/esm/vs/editor/editor.api.js";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";

export const ROWSET_SQL_LANGUAGE = "rowset-sql";

// Monaco 0.53 lists UPDATE both as a keyword and as a built-in function. Its
// tokenizer checks built-ins first, so UPDATE alone is rendered like a plain
// function while SELECT/DELETE are rendered as keywords. Register the same SQL
// grammar under our own id with that duplicate removed.
monaco.languages.register({ id: ROWSET_SQL_LANGUAGE, aliases: ["SQL", "sql"] });
monaco.languages.setLanguageConfiguration(ROWSET_SQL_LANGUAGE, sqlConfiguration);
monaco.languages.setMonarchTokensProvider(ROWSET_SQL_LANGUAGE, {
  ...sqlLanguage,
  builtinFunctions: sqlLanguage.builtinFunctions.filter((name) => name !== "UPDATE"),
});

// Bundle Monaco locally instead of letting @monaco-editor/react load it from a
// CDN at runtime. Vite turns the worker import into an application asset.
(globalThis as typeof globalThis & { MonacoEnvironment: unknown }).MonacoEnvironment = {
  getWorker() {
    return new editorWorker();
  },
};

loader.config({ monaco });

// The editor's colours, defined once so that colouring static SQL outside the
// editor (an object's DDL, statements to review) uses exactly the same theme.
export function defineThemes(monaco: typeof import("monaco-editor/esm/vs/editor/editor.api.js")) {
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

defineThemes(monaco);
monaco.editor.setTheme(document.documentElement.classList.contains("dark") ? "rowset-dark" : "rowset-light");

// Colours a snippet with the editor's own tokenizer and theme, as HTML.
export function colorizeSql(sql: string): Promise<string> {
  return monaco.editor.colorize(sql, ROWSET_SQL_LANGUAGE, { tabSize: 2 });
}

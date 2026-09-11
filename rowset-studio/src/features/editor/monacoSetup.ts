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

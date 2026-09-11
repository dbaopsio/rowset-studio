declare module "monaco-editor/esm/vs/basic-languages/sql/sql.js" {
  import type * as monaco from "monaco-editor/esm/vs/editor/editor.api.js";

  export const conf: monaco.languages.LanguageConfiguration;
  export const language: monaco.languages.IMonarchLanguage & { builtinFunctions: string[] };
}

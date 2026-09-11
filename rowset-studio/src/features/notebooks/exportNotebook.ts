import type { NotebookDocument } from "./api";

type ConnectionNames = Record<string, string>;

function target(cell: { connectionId?: string | null; database?: string }, names: ConnectionNames): string {
  const parts = [cell.connectionId ? `connection: ${names[cell.connectionId] ?? cell.connectionId}` : "", cell.database ? `database: ${cell.database}` : ""].filter(Boolean);
  return parts.join(", ");
}

// Markdown keeps notes as-is and puts every SQL cell in a fenced sql block.
export function notebookToMarkdown(doc: NotebookDocument, names: ConnectionNames = {}): string {
  const parts = [`# ${doc.title}`];
  for (const cell of doc.cells) {
    if (cell.kind === "markdown") {
      parts.push(cell.content.trim());
      continue;
    }
    const where = target(cell, names);
    const fence = cell.content.includes("```") ? "````" : "```";
    parts.push(`${fence}sql\n${where ? `-- ${where}\n` : ""}${cell.content.trim()}\n${fence}`);
  }
  return parts.filter(Boolean).join("\n\n") + "\n";
}

// A runnable script: notes become comments, statements end with a semicolon.
export function notebookToSQL(doc: NotebookDocument, names: ConnectionNames = {}): string {
  const parts = [`-- ${doc.title}`];
  for (const cell of doc.cells) {
    if (cell.kind === "markdown") {
      const text = cell.content.trim();
      if (text) parts.push(text.split("\n").map((line) => `-- ${line}`.trimEnd()).join("\n"));
      continue;
    }
    const sql = cell.content.trim();
    if (!sql) continue;
    const where = target(cell, names);
    parts.push(`${where ? `-- ${where}\n` : ""}${/;\s*$/.test(sql) ? sql : `${sql};`}`);
  }
  return parts.join("\n\n") + "\n";
}

// Characters that are invalid in Windows, macOS or Linux file names.
// eslint-disable-next-line no-control-regex
const UNSAFE_FILE_CHARACTERS = /[\\/:*?"<>|\u0000-\u001f]/g;

export function notebookFileName(title: string, extension: "md" | "sql"): string {
  const base = title.trim().replace(UNSAFE_FILE_CHARACTERS, "_").replace(/\s+/g, " ").slice(0, 120) || "notebook";
  return `${base}.${extension}`;
}

import { api } from "../../lib/api";

export type AiTask = "write" | "explain" | "optimize" | "indexes" | "fix";

export interface AiSettings {
  provider: "none" | "anthropic" | "openai" | "cli";
  model: string;
  shareSchema: boolean;
  hasKey: boolean;
  /** Assistant commands installed on this computer. */
  commands: string[];
}

export interface AiAnswer {
  answer: string;
  /** The statement from the answer, ready to put in the editor. */
  sql: string;
  sharedSchema: boolean;
}

export function getAiSettings() {
  return api<AiSettings>("/ai/settings");
}

export function saveAiSettings(settings: { provider: string; model: string; apiKey?: string; shareSchema: boolean }) {
  return api<AiSettings>("/ai/settings", { method: "PUT", body: JSON.stringify(settings) });
}

export function askAi(request: { connectionId?: string | null; database?: string; task: AiTask; question?: string; sql?: string; error?: string; plan?: string }) {
  return api<AiAnswer>("/ai/ask", {
    method: "POST",
    body: JSON.stringify({
      connectionId: request.connectionId ?? "",
      database: request.database ?? "",
      task: request.task,
      question: request.question ?? "",
      sql: request.sql ?? "",
      error: request.error ?? "",
      plan: request.plan ?? "",
    }),
  });
}

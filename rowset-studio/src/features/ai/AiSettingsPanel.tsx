import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, ErrorText, Field, Input, Panel, Select } from "../../components/ui";
import { getAiSettings, saveAiSettings } from "./api";

// Where the SQL assistant gets its answers: a provider key kept encrypted
// here, or a command already signed in on this computer.
export default function AiSettingsPanel() {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ["ai-settings"], queryFn: getAiSettings });
  const [provider, setProvider] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [shareSchema, setShareSchema] = useState(true);
  const [touched, setTouched] = useState(false);
  const [saved, setSaved] = useState(false);

  const current = settings.data;
  const chosen = touched ? provider : current?.provider ?? "none";
  const commands = current?.commands ?? [];
  const chosenModel = touched ? model : current?.model ?? "";
  const sharing = touched ? shareSchema : current?.shareSchema ?? true;

  const save = useMutation({
    mutationFn: () => saveAiSettings({ provider: chosen, model: chosenModel, apiKey: apiKey || undefined, shareSchema: sharing }),
    onSuccess: (result) => {
      queryClient.setQueryData(["ai-settings"], result);
      setApiKey("");
      setTouched(false);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2000);
    },
  });

  function change(next: string) {
    setTouched(true);
    setProvider(next);
    setModel(next === "cli" ? commands[0] ?? "" : "");
    setShareSchema(sharing);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    save.mutate();
  }

  return (
    <Panel className="p-4">
      <h2 className="text-[14px] font-semibold text-slate-900 dark:text-slate-100">SQL assistant</h2>
      <p className="mt-1 max-w-xl text-[12px] text-slate-500 dark:text-slate-400">
        Writes a statement from your schema, explains or rewrites the one in the editor, suggests an index, and explains a statement that failed.
        Table and column names, their types and indexes are sent as context; the contents of your tables never are.
      </p>
      <form onSubmit={submit} className="mt-4 grid max-w-md gap-3">
        <Field label="Assistant">
          <Select value={chosen} onChange={(event) => change(event.target.value)} aria-label="Assistant">
            <option value="none">Off</option>
            <option value="cli" disabled={commands.length === 0}>
              {commands.length ? `Command on this computer (${commands.join(", ")})` : "Command on this computer (none installed)"}
            </option>
            <option value="anthropic">Anthropic API key</option>
            <option value="openai">OpenAI API key</option>
          </Select>
        </Field>
        {chosen === "cli" && (
          <Field label="Command">
            <Select value={chosenModel} onChange={(event) => { setTouched(true); setModel(event.target.value); }} aria-label="Command">
              {commands.map((name) => <option key={name} value={name}>{name}</option>)}
            </Select>
          </Field>
        )}
        {(chosen === "anthropic" || chosen === "openai") && (
          <>
            <Field label={`Model (optional, default ${chosen === "anthropic" ? "claude-sonnet-5" : "gpt-4.1-mini"})`}>
              <Input value={chosenModel} onChange={(event) => { setTouched(true); setModel(event.target.value); }} placeholder={chosen === "anthropic" ? "claude-sonnet-5" : "gpt-4.1-mini"} />
            </Field>
            <Field label={current?.hasKey ? "API key (leave blank to keep the saved one)" : "API key"}>
              <Input type="password" autoComplete="off" value={apiKey} onChange={(event) => { setTouched(true); setApiKey(event.target.value); }} placeholder="sk-…" />
            </Field>
          </>
        )}
        {chosen !== "none" && (
          <label className="flex items-start gap-2 text-[12px] text-slate-600 dark:text-slate-300">
            <input type="checkbox" checked={sharing} onChange={(event) => { setTouched(true); setShareSchema(event.target.checked); }} className="mt-0.5" />
            <span>
              Send the open database's table names, column types and indexes with each question. Without this the assistant only sees what you type,
              so it cannot know your tables.
            </span>
          </label>
        )}
        {save.isError && <ErrorText>{save.error instanceof Error ? save.error.message : "The assistant could not be saved."}</ErrorText>}
        <div className="flex items-center gap-2">
          <Button type="submit" disabled={save.isPending}>{save.isPending ? "Saving…" : "Save assistant"}</Button>
          {saved && <span className="text-[12px] text-emerald-600 dark:text-emerald-400">Saved</span>}
        </div>
      </form>
    </Panel>
  );
}

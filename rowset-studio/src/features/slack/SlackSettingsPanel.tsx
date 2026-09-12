import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { Button, ErrorText, Field, Input, Panel, Select } from "../../components/ui";

interface SlackSettings {
  configured: boolean;
  scheduleRuns: "all" | "failures" | "off";
  longQuerySeconds: number;
}

function getSlackSettings() {
  return api<SlackSettings>("/slack/settings");
}

// Notifications go to an incoming webhook the user creates in Slack, so
// Rowset needs no Slack app and no token of its own.
export default function SlackSettingsPanel() {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ["slack-settings"], queryFn: getSlackSettings });
  const [webhookUrl, setWebhookUrl] = useState("");
  const [runs, setRuns] = useState("");
  const [minutes, setMinutes] = useState("");
  const [touched, setTouched] = useState(false);
  const [note, setNote] = useState("");

  const current = settings.data;
  const chosenRuns = touched && runs ? runs : current?.scheduleRuns ?? "failures";
  const chosenMinutes = touched && minutes !== "" ? minutes : String(Math.round((current?.longQuerySeconds ?? 0) / 60));

  const save = useMutation({
    mutationFn: () =>
      api<SlackSettings>("/slack/settings", {
        method: "PUT",
        body: JSON.stringify({ webhookUrl, scheduleRuns: chosenRuns, longQuerySeconds: Math.max(0, Number(chosenMinutes) || 0) * 60 }),
      }),
    onSuccess: (result) => {
      queryClient.setQueryData(["slack-settings"], result);
      setTouched(false);
      setNote(result.configured ? "Saved" : "Notifications turned off");
      window.setTimeout(() => setNote(""), 2500);
    },
  });

  const test = useMutation({
    mutationFn: () => api<void>("/slack/test", { method: "POST" }),
    onSuccess: () => { setNote("Sent — check the channel"); window.setTimeout(() => setNote(""), 2500); },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    save.mutate();
  }

  const failure = save.error ?? test.error;

  return (
    <Panel className="p-4">
      <h2 className="text-[14px] font-semibold text-slate-900 dark:text-slate-100">Slack notifications</h2>
      <p className="mt-1 max-w-xl text-[12px] text-slate-500 dark:text-slate-400">
        Create an incoming webhook in Slack for the channel you want, then paste its address here. Rowset posts what ran, how long it took and
        where the file was written — never the rows themselves.
      </p>
      <form onSubmit={submit} className="mt-4 grid max-w-md gap-3">
        <Field label={current?.configured ? "Webhook address (saved; paste again to replace, empty to turn off)" : "Webhook address"}>
          <Input value={webhookUrl} onChange={(event) => { setTouched(true); setWebhookUrl(event.target.value); }} placeholder="https://hooks.slack.com/services/…" autoComplete="off" />
        </Field>
        <Field label="Scheduled queries">
          <Select value={chosenRuns} onChange={(event) => { setTouched(true); setRuns(event.target.value); }} aria-label="Scheduled queries">
            <option value="failures">Post only when a run fails</option>
            <option value="all">Post every run</option>
            <option value="off">Do not post runs</option>
          </Select>
        </Field>
        <Field label="Also post a statement that took longer than (minutes, 0 for never)">
          <Input type="number" min={0} max={1440} value={chosenMinutes} onChange={(event) => { setTouched(true); setMinutes(event.target.value); }} />
        </Field>
        {failure instanceof Error && <ErrorText>{failure.message}</ErrorText>}
        <div className="flex items-center gap-2">
          <Button type="submit" disabled={save.isPending}>{save.isPending ? "Saving…" : "Save notifications"}</Button>
          <button
            type="button"
            disabled={!current?.configured || test.isPending}
            onClick={() => test.mutate()}
            className="inline-flex h-8 items-center rounded-md border border-slate-200 bg-white px-3 text-[13px] font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            {test.isPending ? "Sending…" : "Send a test message"}
          </button>
          {note && <span className="text-[12px] text-emerald-600 dark:text-emerald-400">{note}</span>}
        </div>
      </form>
    </Panel>
  );
}

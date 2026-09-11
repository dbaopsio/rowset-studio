import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../lib/auth";
import { setUserPassword } from "../lib/account";
import { Button, ErrorText, Field, Input } from "../components/ui";
import { AuthShell } from "./Login";

// The desktop owner starts without a password of their own. Choosing one is
// required so they can sign in again after signing out.
export default function SetPassword() {
  const user = useAuth((s) => s.user);
  const login = useAuth((s) => s.login);
  const qc = useQueryClient();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (password !== confirm) { setError("Passwords must match."); return; }
    if (!user) return;
    setBusy(true);
    setError("");
    try {
      await setUserPassword(user.userId, password);
      await login("", password);
      await qc.invalidateQueries({ queryKey: ["me"] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to set the password.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell title="Choose your password" subtitle="You will use it to sign in to Rowset Studio after signing out. It never leaves this computer.">
      <form onSubmit={save} className="space-y-4">
        <Field label="Password">
          <Input type="password" autoComplete="new-password" minLength={8} required autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Field label="Confirm password">
          <Input type="password" autoComplete="new-password" minLength={8} required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
        <p className="text-[12px] text-slate-500 dark:text-slate-400">At least 8 characters.</p>
        <ErrorText>{error}</ErrorText>
        <Button type="submit" disabled={busy} className="w-full">{busy ? "Saving…" : "Set password and continue"}</Button>
      </form>
    </AuthShell>
  );
}

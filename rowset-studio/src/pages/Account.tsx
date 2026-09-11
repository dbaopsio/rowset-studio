import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../lib/auth";
import { setUserPassword } from "../lib/account";

export default function Account() {
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);
  const dismiss = useAuth((s) => s.dismissPasswordAdvice);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!user || password !== confirm) { setError("Passwords must match."); return; }
    setBusy(true); setError("");
    try {
      await setUserPassword(user.userId, password);
      dismiss(); logout(); qc.clear(); navigate("/login");
    } catch (error) { setError(error instanceof Error ? error.message : "Unable to change password."); }
    finally { setBusy(false); }
  }
  return <form onSubmit={save} className="mx-auto max-w-md space-y-4 p-8">
    <h1 className="text-xl font-semibold">Account</h1>
    <p>{user?.email}</p>
    <p className="text-sm">After changing your password, sign in again.</p>
    <label className="block">New password<input className="mt-1 block w-full rounded border p-2 text-slate-900" type="password" autoComplete="new-password" minLength={12} required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
    <label className="block">Confirm password<input className="mt-1 block w-full rounded border p-2 text-slate-900" type="password" autoComplete="new-password" minLength={12} required value={confirm} onChange={(e) => setConfirm(e.target.value)} /></label>
    {error && <p role="alert" className="text-red-600">{error}</p>}
    <button disabled={busy} className="rounded bg-brand-600 px-4 py-2 text-white disabled:opacity-50">{busy ? "Saving…" : "Change password"}</button>
  </form>;
}

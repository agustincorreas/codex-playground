"use client";

import { useState } from "react";

export default function LoginForm() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
    setBusy(false);
    if (res.ok) window.location.href = "/";
    else setError((await res.json().catch(() => ({}))).error || "Error");
  }

  return (
    <form onSubmit={submit} className="card space-y-3 p-4">
      <label className="label">Contraseña</label>
      <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
      {error && <p className="text-sm text-red-500">{error}</p>}
      <button className="btn btn-primary" disabled={busy}>Entrar</button>
    </form>
  );
}

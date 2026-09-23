"use client";

import { useState } from "react";
import { formatBytes } from "@/lib/api";
import type { MusicTrack } from "@/lib/types";

export default function MusicLibrary({ tracks, onChanged }: { tracks: MusicTrack[]; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function upload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    setMsg(null);
    for (const f of Array.from(files)) {
      const fd = new FormData();
      fd.append("file", f);
      const res = await fetch("/api/music", { method: "POST", body: fd });
      if (!res.ok) {
        setMsg((await res.json()).error || `No se pudo subir ${f.name}`);
        break;
      }
    }
    setBusy(false);
    onChanged();
  }

  async function remove(t: MusicTrack) {
    if (!confirm(`¿Borrar "${t.name}" de la biblioteca?`)) return;
    await fetch("/api/music", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: t.path }) });
    onChanged();
  }

  return (
    <section className="card space-y-3 p-4">
      <h2 className="font-medium">Música de fondo</h2>
      <p className="muted text-sm">
        Subí tus pistas (mp3, m4a, wav; hasta 20 MB cada una). Los estilos con música eligen una al azar o la que indiques en el preset,
        la ponen en loop bajo la voz y la bajan cuando alguien habla. Usá música libre de derechos o de la biblioteca de la plataforma donde publiques.
      </p>
      <input type="file" accept=".mp3,.m4a,.wav,.aac,.ogg,.flac,audio/*" multiple className="w-auto" disabled={busy} onChange={(e) => upload(e.target.files)} />
      {msg && <p className="text-sm text-red-500">{msg}</p>}
      {tracks.length === 0 ? (
        <p className="muted text-sm">Biblioteca vacía.</p>
      ) : (
        <ul className="divide-y text-sm" style={{ borderColor: "var(--border)" }}>
          {tracks.map((t) => (
            <li key={t.path} className="flex items-center justify-between py-1.5">
              <span>{t.name} <span className="muted text-xs">{formatBytes(t.size)}</span></span>
              <button className="btn btn-sm" onClick={() => remove(t)}>Borrar</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

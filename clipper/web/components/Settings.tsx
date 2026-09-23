"use client";

import { useEffect, useState } from "react";
import PresetEditor from "./PresetEditor";
import MusicLibrary from "./MusicLibrary";
import type { MusicTrack, Preset } from "@/lib/types";

interface SettingsData {
  google_connected: boolean;
  google_email: string | null;
  google_configured: boolean;
  google_picker_ready: boolean;
  drive_folder_id: string;
  glossary: string;
  cookies_uploaded_at: string | null;
  worker_last_activity: string | null;
}

export default function Settings() {
  const [data, setData] = useState<SettingsData | null>(null);
  const [folder, setFolder] = useState("");
  const [glossary, setGlossary] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [tracks, setTracks] = useState<MusicTrack[]>([]);

  async function load() {
    const res = await fetch("/api/settings", { cache: "no-store" });
    const d = await res.json();
    setData(d);
    setFolder(d.drive_folder_id || "");
    setGlossary(d.glossary || "");
    const p = await fetch("/api/presets").then((r) => r.json());
    setPresets(p.presets || []);
    const m = await fetch("/api/music").then((r) => r.json()).catch(() => ({ tracks: [] }));
    setTracks(m.tracks || []);
  }

  useEffect(() => {
    load();
    const params = new URLSearchParams(window.location.search);
    if (params.get("google_error")) setMsg(`Google: ${params.get("google_error")}`);
    if (params.get("google") === "ok") setMsg("Cuenta de Google conectada.");
  }, []);

  async function uploadCookies(file: File) {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/settings/cookies", { method: "POST", body: fd });
    setMsg(res.ok ? "cookies.txt guardado." : (await res.json()).error);
    load();
  }

  async function saveFolder() {
    await fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ drive_folder_id: folder }) });
    setMsg("Carpeta guardada.");
    load();
  }

  async function saveGlossary() {
    await fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ glossary }) });
    setMsg("Glosario guardado.");
  }

  async function disconnect() {
    await fetch("/api/google/disconnect", { method: "POST" });
    load();
  }

  if (!data) return <p className="muted text-sm">Cargando…</p>;

  return (
    <div className="space-y-8">
      <h1 className="text-xl font-semibold">Configuración</h1>
      {msg && <p className="text-sm text-indigo-500">{msg}</p>}

      <section className="card space-y-3 p-4">
        <h2 className="font-medium">YouTube: cookies.txt</h2>
        <p className="muted text-sm">
          Si YouTube pide verificación (“confirm you’re not a bot”), edad o el video es solo para miembros, exportá tus cookies con una extensión como
          “Get cookies.txt LOCALLY” (formato Netscape) y subilas acá. Se guardan en Storage y el worker las usa en cada descarga.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <input type="file" accept=".txt" className="w-auto" onChange={(e) => e.target.files?.[0] && uploadCookies(e.target.files[0])} />
          {data.cookies_uploaded_at && (
            <>
              <span className="muted text-xs">Subido: {new Date(data.cookies_uploaded_at).toLocaleString("es-AR")}</span>
              <button className="btn btn-sm" onClick={async () => { await fetch("/api/settings/cookies", { method: "DELETE" }); load(); }}>Borrar</button>
            </>
          )}
        </div>
      </section>

      <section className="card space-y-3 p-4">
        <h2 className="font-medium">Google Drive</h2>
        {!data.google_configured ? (
          <p className="muted text-sm">Faltan GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET en las variables de entorno de la web (ver README).</p>
        ) : data.google_connected ? (
          <div className="space-y-3">
            <p className="text-sm">Conectado{data.google_email ? ` como ${data.google_email}` : ""}. <button className="btn btn-sm ml-2" onClick={disconnect}>Desconectar</button></p>
            <div>
              <label className="label">Carpeta de Drive donde guardar los clips (ID o link de la carpeta; vacío = raíz de “Mi unidad”)</label>
              <div className="flex gap-2">
                <input value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="https://drive.google.com/drive/folders/..." />
                <button className="btn" onClick={saveFolder}>Guardar</button>
              </div>
              <p className="muted mt-1 text-xs">La app solo ve los archivos que elegís con el selector y los que ella misma crea (alcance drive.file). Para guardar en una carpeta existente, elegila una vez con el selector o creala desde Drive y pegá el link.</p>
            </div>
            {!data.google_picker_ready && <p className="muted text-xs">Para el selector de archivos falta NEXT_PUBLIC_GOOGLE_API_KEY.</p>}
          </div>
        ) : (
          <a className="btn" href="/api/google/auth">Conectar cuenta de Google</a>
        )}
      </section>

      <section className="card space-y-3 p-4">
        <h2 className="font-medium">Glosario de nombres</h2>
        <p className="muted text-sm">
          Marcas, perfumes, materias primas y nombres propios que usás seguido, uno por línea o separados por coma. La transcripción se revisa contra
          este glosario (más uno de fábrica con las marcas y notas más comunes) y, para los nombres dudosos, se verifica en Fragrantica y Wikipedia.
        </p>
        <textarea rows={4} value={glossary} onChange={(e) => setGlossary(e.target.value)} placeholder={"Fueguia 1833\nSummer Hammer\nFaku (showroom Palermo)"} />
        <button className="btn" onClick={saveGlossary}>Guardar glosario</button>
      </section>

      <section className="card space-y-3 p-4">
        <h2 className="font-medium">Worker</h2>
        <p className="muted text-sm">
          {data.worker_last_activity ? `Última actividad: ${new Date(data.worker_last_activity).toLocaleString("es-AR")}` : "Todavía no procesó ningún trabajo."}
          {presets.length === 0 && " Los presets de fábrica aparecen cuando el worker arranca por primera vez."}
        </p>
      </section>

      <MusicLibrary tracks={tracks} onChanged={load} />

      <section className="space-y-3">
        <h2 className="font-medium">Estilos (presets)</h2>
        <p className="muted text-sm">De más sobrio a más cargado: Natural minimalista, Editorial, Podcast a dos, Intermedio, Dinámico y Viral. Cada uno se puede editar o clonar.</p>
        <PresetEditor presets={presets} tracks={tracks} onChanged={load} />
      </section>
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Preset } from "@/lib/types";
import DrivePicker from "./DrivePicker";

type Mode = "link" | "drive" | "upload";

export default function SourceForm() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("link");
  const [url, setUrl] = useState("");
  const [driveFile, setDriveFile] = useState<{ id: string; name: string } | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [topics, setTopics] = useState("");
  const [minD, setMinD] = useState(60);
  const [maxD, setMaxD] = useState(120);
  const [presetId, setPresetId] = useState("natural");
  const [presets, setPresets] = useState<Preset[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const linksFileRef = useRef<HTMLInputElement>(null);

  // Al elegir un estilo, se toma su duración objetivo (editable después).
  function choosePreset(id: string) {
    setPresetId(id);
    const p = presets.find((x) => x.id === id);
    if (p?.config?.target_duration) {
      setMinD(p.config.target_duration.min);
      setMaxD(p.config.target_duration.max);
    }
  }

  function linksFromText(text: string): string[] {
    return text.split(/[\n\r,;\s]+/).map((x) => x.trim()).filter((x) => /^https?:\/\//i.test(x));
  }

  async function importLinksFile(f: File | undefined) {
    if (!f) return;
    const text = await f.text();
    const links = linksFromText(text);
    if (links.length === 0) return setError("El archivo no tiene links (esperaba uno por línea).");
    setUrl((prev) => (prev.trim() ? prev.trim() + "\n" : "") + links.join("\n"));
    setError(null);
  }

  useEffect(() => {
    fetch("/api/presets").then((r) => r.json()).then((d) => setPresets(d.presets || [])).catch(() => {});
  }, []);

  async function uploadFile(f: File): Promise<{ path: string; name: string }> {
    const sign = await fetch("/api/uploads/sign", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: f.name }) });
    if (!sign.ok) throw new Error((await sign.json()).error || "No se pudo preparar la subida");
    const { path, signedUrl } = await sign.json();
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", signedUrl);
      xhr.setRequestHeader("Content-Type", f.type || "application/octet-stream");
      xhr.setRequestHeader("x-upsert", "true");
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) setProgress(`Subiendo ${Math.round((e.loaded / e.total) * 100)}%`);
      };
      xhr.onload = () => (xhr.status < 300 ? resolve() : reject(new Error(`La subida falló (${xhr.status}). Si el archivo supera el límite de tu plan de Supabase, usá YouTube o Drive.`)));
      xhr.onerror = () => reject(new Error("La subida falló por un error de red."));
      xhr.send(f);
    });
    return { path, name: f.name };
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const body: Record<string, unknown> = { topics, min_duration_s: minD, max_duration_s: maxD, preset_id: presetId };
      if (mode === "link") {
        const links = linksFromText(url);
        if (links.length === 0) throw new Error("Pegá al menos un link de YouTube o de Drive.");
        if (links.length === 1) {
          body.url = links[0];
          body.source_type = /drive\.google\.com/.test(links[0]) ? "drive" : "youtube";
        } else {
          body.urls = links;
        }
      } else if (mode === "drive") {
        if (driveFile) {
          body.source_type = "drive";
          body.drive_file_id = driveFile.id;
          body.drive_file_name = driveFile.name;
        } else if (url.trim()) {
          body.source_type = "drive";
          body.url = url.trim();
        } else {
          throw new Error("Elegí un archivo de Drive o pegá un link de Drive.");
        }
      } else {
        if (!file) throw new Error("Elegí un archivo (mp4, mov, m4a o mp3).");
        const up = await uploadFile(file);
        body.source_type = "upload";
        body.upload_path = up.path;
        body.upload_name = up.name;
      }
      setProgress("Creando…");
      const res = await fetch("/api/videos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudo crear");
      if (data.count && data.count > 1) router.push("/#historial");
      else router.push(`/v/${data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  const tab = (m: Mode, label: string) => (
    <button
      type="button"
      onClick={() => setMode(m)}
      className={`rounded-md px-3 py-1.5 text-sm ${mode === m ? "bg-indigo-600 text-white" : "muted hover:underline"}`}
    >
      {label}
    </button>
  );

  return (
    <form onSubmit={submit} className="card space-y-4 p-4">
      <div className="flex gap-1">{tab("link", "Link de YouTube")}{tab("drive", "Google Drive")}{tab("upload", "Subir archivo")}</div>

      {mode === "link" && (
        <div>
          <label className="label">Links de YouTube (públicos o no listados) o de Google Drive, uno por línea</label>
          <textarea rows={url.includes("\n") ? 4 : 2} placeholder={"https://www.youtube.com/watch?v=...\nhttps://drive.google.com/file/d/..."} value={url} onChange={(e) => setUrl(e.target.value)} />
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
            <button type="button" className="btn btn-sm" onClick={() => linksFileRef.current?.click()}>Importar lista de links (.txt / .csv)</button>
            <input ref={linksFileRef} type="file" accept=".txt,.csv,text/plain" className="hidden" onChange={(e) => importLinksFile(e.target.files?.[0])} />
            {linksFromText(url).length > 1 && <span className="muted">{linksFromText(url).length} videos: se procesan uno detrás del otro, todos con estos mismos ajustes.</span>}
          </div>
        </div>
      )}

      {mode === "drive" && (
        <div className="space-y-2">
          <DrivePicker onPick={(f) => { setDriveFile(f); setUrl(""); }} />
          {driveFile && <p className="text-sm">Elegido: <b>{driveFile.name}</b> <button type="button" className="btn btn-sm ml-2" onClick={() => setDriveFile(null)}>Quitar</button></p>}
          <div>
            <label className="label">o pegá un link de Drive (archivo compartido como “cualquiera con el link”)</label>
            <input placeholder="https://drive.google.com/file/d/..." value={url} onChange={(e) => { setUrl(e.target.value); setDriveFile(null); }} />
          </div>
        </div>
      )}

      {mode === "upload" && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files?.[0]; if (f) setFile(f); }}
          onClick={() => inputRef.current?.click()}
          className={`cursor-pointer rounded-lg border border-dashed p-6 text-center text-sm ${dragging ? "border-indigo-500" : ""}`}
          style={{ borderColor: dragging ? undefined : "var(--border)" }}
        >
          <input ref={inputRef} type="file" accept=".mp4,.mov,.m4a,.mp3,video/mp4,video/quicktime,audio/mp4,audio/mpeg" className="hidden" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          {file ? <span>{file.name} · {(file.size / 1e6).toFixed(0)} MB</span> : <span className="muted">Arrastrá un archivo acá o hacé clic para elegir (mp4, mov, m4a, mp3)</span>}
        </div>
      )}

      {presets.find((p) => p.id === presetId)?.config?.description && (
        <p className="muted text-xs">{presets.find((p) => p.id === presetId)?.config?.description}</p>
      )}

      <div>
        <label className="label">Temas a buscar (opcional)</label>
        <input placeholder="ej. honestidad de los reseñadores, marcas nicho compradas por corporaciones" value={topics} onChange={(e) => setTopics(e.target.value)} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <label className="label">Duración mínima (s)</label>
          <input type="number" min={15} max={170} value={minD} onChange={(e) => setMinD(Number(e.target.value))} />
        </div>
        <div>
          <label className="label">Duración máxima (s)</label>
          <input type="number" min={25} max={180} value={maxD} onChange={(e) => setMaxD(Number(e.target.value))} />
        </div>
        <div>
          <label className="label">Estilo</label>
          <select value={presetId} onChange={(e) => choosePreset(e.target.value)}>
            {presets.length === 0 && <option value="natural">Natural minimalista</option>}
            {presets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}
      <div className="flex items-center gap-3">
        <button className="btn btn-primary" disabled={busy}>{busy ? "Enviando…" : "Generar"}</button>
        {progress && <span className="muted text-sm">{progress}</span>}
      </div>
    </form>
  );
}

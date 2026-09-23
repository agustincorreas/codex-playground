"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatBytes, formatDuration } from "@/lib/api";
import { CLIP_STATUS_LABEL, type Clip, type Preset } from "@/lib/types";

interface Props {
  clip: Clip;
  presets: Preset[];
  videoDuration: number;
  googleConnected: boolean;
  onChanged: () => void;
}

function cueKey(c: { k?: string; s: number }, origStart: number) {
  return c.k || String(Math.round((origStart + c.s) * 1000));
}

function fmt(t: number) {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
}

export default function ClipCard({ clip, presets, videoDuration, googleConnected, onChanged }: Props) {
  const [start, setStart] = useState(clip.start_s);
  const [end, setEnd] = useState(clip.end_s);
  const [title, setTitle] = useState(clip.title);
  const [edits, setEdits] = useState<Record<string, string>>(clip.subtitle_edits || {});
  const [presetId, setPresetId] = useState<string>(clip.preset_id || "");
  const [showSubs, setShowSubs] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Cuando el servidor manda cambios (p. ej. tras renderizar), sincronizamos lo que no está siendo editado.
  useEffect(() => {
    setStart(clip.start_s);
    setEnd(clip.end_s);
    setTitle(clip.title);
    setEdits(clip.subtitle_edits || {});
    setPresetId(clip.preset_id || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clip.updated_at]);

  const dirty = start !== clip.start_s || end !== clip.end_s || title !== clip.title || presetId !== (clip.preset_id || "") || JSON.stringify(edits) !== JSON.stringify(clip.subtitle_edits || {});
  const busy = clip.status === "queued" || clip.status === "rendering";
  const offset = clip.preview_offset_s ?? 0;
  const previewDuration = useMemo(() => Math.max(0, (videoRef.current?.duration || 0)), [current]); // eslint-disable-line react-hooks/exhaustive-deps
  const minStart = offset;
  const maxEnd = previewDuration > 0 ? offset + previewDuration : videoDuration || end + 20;

  // Reproducción acotada al rango elegido.
  function onTimeUpdate() {
    const v = videoRef.current;
    if (!v) return;
    const t = v.currentTime + offset;
    setCurrent(t);
    if (t >= end) {
      v.pause();
      v.currentTime = Math.max(0, start - offset);
    }
  }
  function playFrom(t: number) {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.max(0, t - offset);
    v.play().catch(() => {});
  }
  function seekTo(t: number) {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    v.currentTime = Math.max(0, t - offset);
    setCurrent(t);
  }

  const setStartClamped = (t: number) => { const v = Math.max(minStart, Math.min(end - 3, Math.round(t * 10) / 10)); setStart(v); seekTo(v); };
  const setEndClamped = (t: number) => { const v = Math.min(maxEnd, Math.max(start + 3, Math.round(t * 10) / 10)); setEnd(v); seekTo(Math.max(start, v - 2)); };

  async function save(): Promise<boolean> {
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/clips/${clip.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ start_s: start, end_s: end, title, subtitle_edits: edits, preset_id: presetId || null }),
    });
    setSaving(false);
    if (!res.ok) {
      setError((await res.json()).error || "No se pudo guardar");
      return false;
    }
    onChanged();
    return true;
  }

  async function render() {
    if (dirty && !(await save())) return;
    const res = await fetch(`/api/clips/${clip.id}/render`, { method: "POST" });
    if (!res.ok) setError((await res.json()).error);
    onChanged();
  }

  async function saveToDrive() {
    const res = await fetch(`/api/clips/${clip.id}/drive`, { method: "POST" });
    if (!res.ok) setError((await res.json()).error);
    onChanged();
  }

  const cues = clip.subtitles || [];
  const activeCue = cues.find((c) => current - clip.orig_start_s >= c.s && current - clip.orig_start_s < c.e);

  return (
    <div className="card p-4">
      <div className="flex flex-col gap-4 md:flex-row">
        {/* Vista previa */}
        <div className="w-full shrink-0 md:w-80">
          {clip.preview_url ? (
            <video
              ref={videoRef}
              src={clip.preview_url}
              poster={clip.thumb_url || undefined}
              controls
              playsInline
              preload="metadata"
              className="w-full rounded-lg bg-black"
              onTimeUpdate={onTimeUpdate}
              onLoadedMetadata={() => { const v = videoRef.current; if (v) v.currentTime = Math.max(0, start - offset); }}
            />
          ) : clip.thumb_url ? (
            <img src={clip.thumb_url} alt="" className="w-full rounded-lg" />
          ) : (
            <div className="muted flex aspect-video items-center justify-center rounded-lg text-xs" style={{ background: "var(--border)" }}>Generando vista previa…</div>
          )}
          {activeCue && <p className="muted mt-1 truncate text-center text-xs">{edits[cueKey(activeCue, clip.orig_start_s)] ?? activeCue.text}</p>}
          <div className="mt-2 flex items-center justify-between text-xs">
            <button type="button" className="btn btn-sm" onClick={() => playFrom(start)}>▶ Desde el inicio</button>
            <span className="muted">{fmt(current)}</span>
            <button type="button" className="btn btn-sm" onClick={() => playFrom(Math.max(start, end - 5))}>Últimos 5 s</button>
          </div>
        </div>

        {/* Datos y edición */}
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <input value={title} onChange={(e) => setTitle(e.target.value)} className="font-medium" placeholder="Título" />
              <p className="muted mt-1 text-xs">
                Puntaje <b>{clip.score}/10</b> · {formatDuration(end - start)} · {fmt(start)} → {fmt(end)}
              </p>
            </div>
            <span className={`text-xs ${clip.status === "error" ? "text-red-500" : clip.status === "ready" ? "text-emerald-600" : busy ? "text-indigo-500" : "muted"}`}>
              {CLIP_STATUS_LABEL[clip.status]}{clip.status_detail ? ` · ${clip.status_detail}` : ""}
            </span>
          </div>

          <p className="text-sm">“{clip.hook}”</p>
          <p className="muted text-xs">{clip.reason}</p>

          {/* Ajuste fino */}
          <div className="space-y-2 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-12 muted text-xs">Inicio</span>
              <button type="button" className="btn btn-sm" onClick={() => setStartClamped(start - 1)} disabled={busy}>−1 s</button>
              <input type="range" min={minStart} max={end - 3} step={0.1} value={start} onChange={(e) => setStartClamped(Number(e.target.value))} className="flex-1" disabled={busy} />
              <button type="button" className="btn btn-sm" onClick={() => setStartClamped(start + 1)} disabled={busy}>+1 s</button>
              <span className="w-14 text-right text-xs">{fmt(start)}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-12 muted text-xs">Fin</span>
              <button type="button" className="btn btn-sm" onClick={() => setEndClamped(end - 1)} disabled={busy}>−1 s</button>
              <input type="range" min={start + 3} max={maxEnd} step={0.1} value={end} onChange={(e) => setEndClamped(Number(e.target.value))} className="flex-1" disabled={busy} />
              <button type="button" className="btn btn-sm" onClick={() => setEndClamped(end + 1)} disabled={busy}>+1 s</button>
              <span className="w-14 text-right text-xs">{fmt(end)}</span>
            </div>
            <p className="muted text-xs">La vista previa cubre desde {fmt(offset)} hasta {fmt(maxEnd)}; dentro de ese rango podés mover el inicio y el fin.</p>
          </div>

          {/* Subtítulos por línea */}
          <div>
            <button type="button" className="text-xs underline" onClick={() => setShowSubs((s) => !s)}>
              {showSubs ? "Ocultar subtítulos" : `Editar subtítulos (${cues.length} líneas)`}
            </button>
            {showSubs && (
              <div className="mt-2 max-h-72 space-y-1 overflow-y-auto pr-1">
                {cues.map((c) => {
                  const key = cueKey(c, clip.orig_start_s);
                  return (
                    <div key={key} className="flex items-center gap-2">
                      <button type="button" className="muted w-12 shrink-0 text-left text-xs hover:underline" onClick={() => seekTo(clip.orig_start_s + c.s)}>{fmt(clip.orig_start_s + c.s)}</button>
                      <input
                        value={edits[key] ?? c.text}
                        onChange={(e) => setEdits((prev) => { const next = { ...prev }; if (e.target.value === c.text) delete next[key]; else next[key] = e.target.value; return next; })}
                        className="text-sm"
                        disabled={busy}
                      />
                    </div>
                  );
                })}
                {cues.length === 0 && <p className="muted text-xs">Sin subtítulos generados.</p>}
                {(start !== clip.orig_start_s || end !== clip.orig_end_s) && <p className="muted text-xs">Si cambiás inicio/fin, las líneas se regeneran al renderizar; las ediciones se conservan por línea.</p>}
              </div>
            )}
          </div>

          {/* Acciones */}
          <div className="flex flex-wrap items-center gap-2">
            {presets.length > 1 && (
              <select value={presetId} onChange={(e) => setPresetId(e.target.value)} className="w-auto text-sm" disabled={busy}>
                <option value="">Estilo del video</option>
                {presets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            )}
            {dirty && <button type="button" className="btn btn-sm" onClick={save} disabled={saving || busy}>Guardar cambios</button>}
            <button type="button" className="btn btn-primary btn-sm" onClick={render} disabled={busy}>
              {busy ? "Renderizando…" : clip.status === "ready" ? "Volver a renderizar" : "Renderizar"}
            </button>
            {clip.status === "ready" && clip.render_url && (
              <a className="btn btn-sm" href={clip.render_url} download={`${title || "clip"}.mp4`}>Descargar {formatBytes(clip.render_bytes)}</a>
            )}
            {clip.status === "ready" && clip.render_url && googleConnected && (
              clip.drive_url ? <a className="btn btn-sm" href={clip.drive_url} target="_blank" rel="noreferrer">Ver en Drive</a>
              : <button type="button" className="btn btn-sm" onClick={saveToDrive} disabled={!!clip.status_detail}>Guardar en Drive</button>
            )}
          </div>
          {(error || clip.error) && <p className="text-sm text-red-500">{error || clip.error}</p>}
          {clip.status === "ready" && dirty && <p className="muted text-xs">Hay cambios sin renderizar: el archivo descargable es el render anterior.</p>}
        </div>
      </div>
    </div>
  );
}

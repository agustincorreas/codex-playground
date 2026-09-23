"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import StatusBar from "./StatusBar";
import ClipCard from "./ClipCard";
import BatchDownload from "./BatchDownload";
import { formatDuration } from "@/lib/api";
import type { Clip, Preset, Video } from "@/lib/types";

const SOURCE_LABEL = { youtube: "YouTube", drive: "Google Drive", upload: "Archivo subido" };

export default function VideoView({ id }: { id: string }) {
  const [video, setVideo] = useState<Video | null>(null);
  const [clips, setClips] = useState<Clip[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [googleConnected, setGoogleConnected] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/videos/${id}`, { cache: "no-store" });
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error || "No se pudo cargar el video");
      return;
    }
    const data = await res.json();
    setVideo(data.video);
    setClips(data.clips);
  }, [id]);

  useEffect(() => {
    load();
    fetch("/api/presets").then((r) => r.json()).then((d) => setPresets(d.presets || [])).catch(() => {});
    fetch("/api/settings").then((r) => r.json()).then((d) => setGoogleConnected(!!d.google_connected)).catch(() => {});
  }, [load]);

  // Sondeo mientras haya algo en proceso.
  const busy = !!video && (video.status !== "ready" && video.status !== "error" || !!video.status_detail || clips.some((c) => c.status === "queued" || c.status === "rendering" || (c.status_detail && c.status_detail.includes("Drive"))));
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [busy, load]);

  async function setMirror(mirror: "auto" | "flip" | "none") {
    const res = await fetch(`/api/videos/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mirror }) });
    if (!res.ok) setError((await res.json()).error);
    else load();
  }

  async function retry() {
    const res = await fetch(`/api/videos/${id}/retry`, { method: "POST" });
    if (!res.ok) setError((await res.json()).error);
    else load();
  }

  if (error) return <p className="text-red-500">{error}</p>;
  if (!video) return <p className="muted text-sm">Cargando…</p>;

  const readyClips = clips.filter((c) => c.status === "ready" && c.render_url);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/" className="muted text-sm hover:underline">← Volver</Link>
        <h1 className="mt-1 text-xl font-semibold">{video.title || video.source_url || video.source_name}</h1>
        <p className="muted text-sm">
          {SOURCE_LABEL[video.source_type]} · {formatDuration(video.duration_s)} · {video.min_duration_s}-{video.max_duration_s} s · estilo {presets.find((p) => p.id === video.preset_id)?.name || video.preset_id}
          {video.topics && <> · temas: {video.topics}</>}
          {video.source_url && <> · <a className="underline" href={video.source_url} target="_blank" rel="noreferrer">abrir origen</a></>}
        </p>
      </div>

      <StatusBar status={video.status} detail={video.status_detail} error={video.error} />

      {(video.status === "ready" || video.status === "error") && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="muted">Imagen en espejo (cámara frontal):</span>
          <select value={video.mirror || "auto"} onChange={(e) => setMirror(e.target.value as "auto" | "flip" | "none")} className="w-auto">
            <option value="auto">Automático ({video.mirror_detected ? "detectada en espejo, se da vuelta" : "no se detectó, se deja como está"})</option>
            <option value="flip">Dar vuelta</option>
            <option value="none">Dejar como está</option>
          </select>
          <span className="muted text-xs">Aplica a los próximos renders. Las vistas previas se generaron con la detección automática.</span>
        </div>
      )}
      {video.status === "error" && (
        <button className="btn" onClick={retry}>Reintentar</button>
      )}

      {clips.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">{clips.length} candidatos</h2>
          <BatchDownload clips={readyClips} videoTitle={video.title || "clips"} />
        </div>
      )}

      <div className="space-y-4">
        {clips.map((c) => (
          <ClipCard key={c.id} clip={c} presets={presets} videoDuration={video.duration_s || 0} googleConnected={googleConnected} onChanged={load} />
        ))}
      </div>
    </div>
  );
}

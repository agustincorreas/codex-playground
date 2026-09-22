"use client";

import { useEffect, useState } from "react";
import SourceForm from "./SourceForm";
import HistoryList from "./HistoryList";
import type { Video } from "@/lib/types";

export default function Home() {
  const [videos, setVideos] = useState<Video[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/videos", { cache: "no-store" });
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error || "No se pudo cargar el historial");
      return;
    }
    setVideos((await res.json()).videos);
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="space-y-10">
      <section>
        <h1 className="mb-1 text-xl font-semibold">Nuevo video</h1>
        <p className="muted mb-4 text-sm">Pegá un link de YouTube, elegí un archivo de Google Drive o subí un archivo. Los candidatos aparecen en unos minutos.</p>
        <SourceForm />
      </section>
      <section id="historial">
        <h2 className="mb-3 text-lg font-semibold">Historial</h2>
        {error && <p className="text-sm text-red-500">{error}</p>}
        <HistoryList videos={videos} onChanged={load} />
      </section>
    </div>
  );
}

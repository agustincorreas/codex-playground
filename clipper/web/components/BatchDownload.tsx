"use client";

import { useState } from "react";
import { zipSync } from "fflate";
import type { Clip } from "@/lib/types";

function fileName(c: Clip, i: number) {
  const base = (c.title || `clip-${i + 1}`).replace(/[^\w\sáéíóúüñÁÉÍÓÚÜÑ-]+/g, "").trim().replace(/\s+/g, "_").slice(0, 60);
  return `${String(i + 1).padStart(2, "0")}_${base || "clip"}.mp4`;
}

/** Descarga todos los clips renderizados en un zip armado en el navegador. */
export default function BatchDownload({ clips, videoTitle }: { clips: Clip[]; videoTitle: string }) {
  const [busy, setBusy] = useState<string | null>(null);
  if (clips.length === 0) return null;

  async function download() {
    setBusy("Preparando…");
    try {
      const files: Record<string, Uint8Array> = {};
      for (let i = 0; i < clips.length; i++) {
        setBusy(`Bajando ${i + 1}/${clips.length}`);
        const res = await fetch(clips[i].render_url!);
        if (!res.ok) throw new Error(`No se pudo bajar el clip ${i + 1}`);
        files[fileName(clips[i], i)] = new Uint8Array(await res.arrayBuffer());
      }
      setBusy("Comprimiendo…");
      const zipped = zipSync(files, { level: 0 });
      const blob = new Blob([zipped as BlobPart], { type: "application/zip" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${videoTitle.replace(/[^\w\s-]+/g, "").trim().replace(/\s+/g, "_").slice(0, 50) || "clips"}.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <button className="btn" onClick={download} disabled={!!busy}>
      {busy || `Descargar ${clips.length} renderizados (zip)`}
    </button>
  );
}

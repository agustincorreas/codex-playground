"use client";

import Link from "next/link";
import { formatDuration } from "@/lib/api";
import { VIDEO_STATUS_LABEL, type Video } from "@/lib/types";

const SOURCE_LABEL = { youtube: "YouTube", drive: "Drive", upload: "Archivo" };

export default function HistoryList({ videos, onChanged }: { videos: Video[] | null; onChanged: () => void }) {
  if (videos === null) return <p className="muted text-sm">Cargando…</p>;
  if (videos.length === 0) return <p className="muted text-sm">Todavía no procesaste ningún video.</p>;

  async function remove(v: Video) {
    if (!confirm(`¿Borrar "${v.title || v.source_url}" y sus clips?`)) return;
    await fetch(`/api/videos/${v.id}`, { method: "DELETE" });
    onChanged();
  }

  return (
    <ul className="divide-y overflow-hidden rounded-xl border" style={{ borderColor: "var(--border)" }}>
      {videos.map((v) => (
        <li key={v.id} className="flex flex-wrap items-center gap-3 px-4 py-3" style={{ borderColor: "var(--border)" }}>
          <div className="min-w-0 flex-1">
            <Link href={`/v/${v.id}`} className="block truncate font-medium hover:underline">
              {v.title || v.source_url || v.source_name || v.id}
            </Link>
            <p className="muted text-xs">
              {SOURCE_LABEL[v.source_type]} · {formatDuration(v.duration_s)} · {new Date(v.created_at).toLocaleString("es-AR")}
              {v.candidates_count > 0 && ` · ${v.candidates_count} candidatos`}
            </p>
          </div>
          <span className={`text-xs ${v.status === "error" ? "text-red-500" : v.status === "ready" ? "text-emerald-600" : "text-indigo-500"}`}>
            {VIDEO_STATUS_LABEL[v.status]}
            {v.status_detail && v.status !== "ready" ? ` · ${v.status_detail}` : ""}
          </span>
          <button className="btn btn-sm" onClick={() => remove(v)} title="Borrar">Borrar</button>
        </li>
      ))}
    </ul>
  );
}

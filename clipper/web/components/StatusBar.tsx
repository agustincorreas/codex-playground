"use client";

import { VIDEO_STATUS_LABEL, type VideoStatus } from "@/lib/types";

const STEPS: VideoStatus[] = ["downloading", "transcribing", "selecting", "ready"];

export default function StatusBar({ status, detail, error }: { status: VideoStatus; detail?: string | null; error?: string | null }) {
  const idx = status === "queued" ? -1 : STEPS.indexOf(status);
  return (
    <div className="card p-4">
      <ol className="flex flex-wrap items-center gap-2 text-sm">
        {STEPS.map((s, i) => {
          const done = status === "ready" ? i <= idx : i < idx;
          const active = i === idx && status !== "ready";
          return (
            <li key={s} className="flex items-center gap-2">
              <span
                className={`inline-block h-2.5 w-2.5 rounded-full ${done ? "bg-emerald-500" : active ? "animate-pulse bg-indigo-500" : "bg-gray-300 dark:bg-gray-700"}`}
              />
              <span className={done || active ? "" : "muted"}>{VIDEO_STATUS_LABEL[s]}</span>
              {i < STEPS.length - 1 && <span className="muted">→</span>}
            </li>
          );
        })}
      </ol>
      {status === "queued" && <p className="muted mt-2 text-sm">En cola: esperando al worker.</p>}
      {detail && status !== "error" && <p className="muted mt-2 text-sm">{detail}</p>}
      {status === "error" && (
        <p className="mt-2 text-sm text-red-500">{error || "Error desconocido"}</p>
      )}
    </div>
  );
}

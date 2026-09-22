"use client";

import { useEffect, useState } from "react";
import type { Preset, PresetConfig } from "@/lib/types";

const FONTS = ["Inter", "Liberation Serif", "Liberation Sans", "DejaVu Sans", "DejaVu Serif"];

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

export default function PresetEditor({ presets, onChanged }: { presets: Preset[]; onChanged: () => void }) {
  const [selected, setSelected] = useState<string>("");
  const [name, setName] = useState("");
  const [cfg, setCfg] = useState<PresetConfig | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!selected && presets.length > 0) pick(presets[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presets]);

  function pick(id: string) {
    const p = presets.find((x) => x.id === id);
    if (!p) return;
    setSelected(id);
    setName(p.name);
    setCfg(clone(p.config));
    setIsNew(false);
    setMsg(null);
  }

  function startNew() {
    const base = presets.find((x) => x.id === selected) || presets[0];
    if (!base) return;
    setCfg(clone(base.config));
    setName(`${base.name} (copia)`);
    setIsNew(true);
    setMsg(null);
  }

  async function save() {
    if (!cfg) return;
    const body = JSON.stringify({ name, config: { ...cfg, name } });
    const res = isNew
      ? await fetch("/api/presets", { method: "POST", headers: { "Content-Type": "application/json" }, body })
      : await fetch(`/api/presets/${selected}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body });
    const data = await res.json();
    if (!res.ok) return setMsg(data.error);
    setMsg("Guardado.");
    setIsNew(false);
    setSelected(data.preset.id);
    onChanged();
  }

  async function remove() {
    if (!confirm("¿Borrar este preset?")) return;
    const res = await fetch(`/api/presets/${selected}`, { method: "DELETE" });
    if (!res.ok) return setMsg((await res.json()).error);
    setSelected("");
    setCfg(null);
    onChanged();
  }

  const upd = (fn: (c: PresetConfig) => void) => setCfg((prev) => { if (!prev) return prev; const next = clone(prev); fn(next); return next; });

  if (presets.length === 0) return <p className="muted text-sm">Todavía no hay presets (el worker los carga al arrancar).</p>;

  return (
    <div className="card space-y-4 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <select value={isNew ? "__new" : selected} onChange={(e) => pick(e.target.value)} className="w-auto">
          {isNew && <option value="__new">Nuevo preset</option>}
          {presets.map((p) => <option key={p.id} value={p.id}>{p.name}{p.builtin ? " (fábrica)" : ""}</option>)}
        </select>
        <button className="btn btn-sm" onClick={startNew}>Crear nuevo a partir de este</button>
        {!isNew && !presets.find((p) => p.id === selected)?.builtin && <button className="btn btn-sm" onClick={remove}>Borrar</button>}
      </div>

      {cfg && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <label className="label">Nombre</label>
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          <fieldset className="space-y-2 rounded-lg border p-3" style={{ borderColor: "var(--border)" }}>
            <legend className="px-1 text-sm font-medium">Subtítulos</legend>
            <Row label="Tipografía"><select value={cfg.subtitles.font} onChange={(e) => upd((c) => { c.subtitles.font = e.target.value; })}>{FONTS.map((f) => <option key={f}>{f}</option>)}</select></Row>
            <Row label="Tamaño"><input type="number" min={30} max={120} value={cfg.subtitles.size} onChange={(e) => upd((c) => { c.subtitles.size = Number(e.target.value); })} /></Row>
            <Row label="Color"><input type="color" value={cfg.subtitles.color} onChange={(e) => upd((c) => { c.subtitles.color = e.target.value; })} className="h-9 w-16 p-0" /></Row>
            <Row label="Líneas"><select value={cfg.subtitles.lines} onChange={(e) => upd((c) => { c.subtitles.lines = Number(e.target.value); })}><option value={1}>1</option><option value={2}>2</option></select></Row>
            <Row label="Caracteres por línea"><input type="number" min={12} max={40} value={cfg.subtitles.max_chars_per_line} onChange={(e) => upd((c) => { c.subtitles.max_chars_per_line = Number(e.target.value); })} /></Row>
            <Row label="Posición (margen inferior, px)"><input type="number" min={100} max={900} value={cfg.safe_area.bottom} onChange={(e) => upd((c) => { c.safe_area.bottom = Number(e.target.value); })} /></Row>
            <Check label="Negrita" checked={cfg.subtitles.bold} onChange={(v) => upd((c) => { c.subtitles.bold = v; })} />
            <Check label="Sombra suave" checked={cfg.subtitles.shadow} onChange={(v) => upd((c) => { c.subtitles.shadow = v; })} />
            <Row label="Contorno (px)"><input type="number" min={0} max={6} value={cfg.subtitles.outline} onChange={(e) => upd((c) => { c.subtitles.outline = Number(e.target.value); })} /></Row>
            <Check label="Mayúsculas" checked={cfg.subtitles.uppercase} onChange={(v) => upd((c) => { c.subtitles.uppercase = v; })} />
            <Check label="Resaltar palabra activa" checked={cfg.subtitles.highlight} onChange={(v) => upd((c) => { c.subtitles.highlight = v; })} />
            {cfg.subtitles.highlight && <Row label="Color de resaltado"><input type="color" value={cfg.subtitles.highlight_color} onChange={(e) => upd((c) => { c.subtitles.highlight_color = e.target.value; })} className="h-9 w-16 p-0" /></Row>}
          </fieldset>

          <div className="space-y-4">
            <fieldset className="space-y-2 rounded-lg border p-3" style={{ borderColor: "var(--border)" }}>
              <legend className="px-1 text-sm font-medium">Título</legend>
              <Check label="Mostrar título" checked={cfg.title.show} onChange={(v) => upd((c) => { c.title.show = v; })} />
              {cfg.title.show && (
                <>
                  <Check label="Permanente (si no, solo los primeros segundos)" checked={cfg.title.permanent} onChange={(v) => upd((c) => { c.title.permanent = v; })} />
                  {!cfg.title.permanent && <Row label="Segundos"><input type="number" min={1} max={15} value={cfg.title.duration_s} onChange={(e) => upd((c) => { c.title.duration_s = Number(e.target.value); })} /></Row>}
                  <Row label="Tipografía"><select value={cfg.title.font} onChange={(e) => upd((c) => { c.title.font = e.target.value; })}>{FONTS.map((f) => <option key={f}>{f}</option>)}</select></Row>
                  <Row label="Tamaño"><input type="number" min={30} max={140} value={cfg.title.size} onChange={(e) => upd((c) => { c.title.size = Number(e.target.value); })} /></Row>
                  <Row label="Color"><input type="color" value={cfg.title.color} onChange={(e) => upd((c) => { c.title.color = e.target.value; })} className="h-9 w-16 p-0" /></Row>
                  <Row label="Líneas"><select value={cfg.title.lines} onChange={(e) => upd((c) => { c.title.lines = Number(e.target.value); })}><option value={1}>1</option><option value={2}>2</option></select></Row>
                </>
              )}
            </fieldset>

            <fieldset className="space-y-2 rounded-lg border p-3" style={{ borderColor: "var(--border)" }}>
              <legend className="px-1 text-sm font-medium">Cámara y hablantes</legend>
              <Check label="Leve zoom al cambiar de hablante" checked={cfg.camera.zoom_on_speaker_change} onChange={(v) => upd((c) => { c.camera.zoom_on_speaker_change = v; })} />
              {cfg.camera.zoom_on_speaker_change && <Row label="Zoom (1.05–1.3)"><input type="number" step={0.01} min={1.02} max={1.3} value={cfg.camera.zoom_amount} onChange={(e) => upd((c) => { c.camera.zoom_amount = Number(e.target.value); })} /></Row>}
              <Row label="Suavizado del seguimiento (0–0.95)"><input type="number" step={0.05} min={0} max={0.95} value={cfg.camera.smoothing} onChange={(e) => upd((c) => { c.camera.smoothing = Number(e.target.value); })} /></Row>
              <Row label="Dos personas en cámara">
                <select value={cfg.two_speakers} onChange={(e) => upd((c) => { c.two_speakers = e.target.value as "switch" | "split"; })}>
                  <option value="switch">Cambiar según quién habla</option>
                  <option value="split">Dividido arriba/abajo</option>
                </select>
              </Row>
            </fieldset>

            <fieldset className="space-y-2 rounded-lg border p-3" style={{ borderColor: "var(--border)" }}>
              <legend className="px-1 text-sm font-medium">Márgenes seguros (px sobre 1080×1920)</legend>
              <div className="grid grid-cols-2 gap-2">
                <Row label="Arriba"><input type="number" value={cfg.safe_area.top} onChange={(e) => upd((c) => { c.safe_area.top = Number(e.target.value); })} /></Row>
                <Row label="Abajo"><input type="number" value={cfg.safe_area.bottom} onChange={(e) => upd((c) => { c.safe_area.bottom = Number(e.target.value); })} /></Row>
                <Row label="Izquierda"><input type="number" value={cfg.safe_area.left} onChange={(e) => upd((c) => { c.safe_area.left = Number(e.target.value); })} /></Row>
                <Row label="Derecha"><input type="number" value={cfg.safe_area.right} onChange={(e) => upd((c) => { c.safe_area.right = Number(e.target.value); })} /></Row>
              </div>
              <p className="muted text-xs">Referencia: Instagram/TikTok tapan ~250 px arriba, ~420 px abajo y ~130 px a la derecha.</p>
            </fieldset>
          </div>
        </div>
      )}

      <div className="flex items-center gap-3">
        <button className="btn btn-primary" onClick={save} disabled={!cfg}>{isNew ? "Crear preset" : "Guardar cambios"}</button>
        {msg && <span className="muted text-sm">{msg}</span>}
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
    </label>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

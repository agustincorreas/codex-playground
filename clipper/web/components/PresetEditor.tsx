"use client";

import { useEffect, useState } from "react";
import type { MusicTrack, Preset, PresetConfig } from "@/lib/types";

const FONTS = ["Inter", "Montserrat", "Bebas Neue", "Roboto", "Open Sans", "Lato", "Liberation Sans", "Liberation Serif", "DejaVu Sans", "DejaVu Serif"];

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

export default function PresetEditor({ presets, tracks, onChanged }: { presets: Preset[]; tracks: MusicTrack[]; onChanged: () => void }) {
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

  const current = presets.find((p) => p.id === selected);

  return (
    <div className="card space-y-4 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <select value={isNew ? "__new" : selected} onChange={(e) => pick(e.target.value)} className="w-auto">
          {isNew && <option value="__new">Nuevo preset</option>}
          {presets.map((p) => <option key={p.id} value={p.id}>{p.name}{p.builtin ? " (fábrica)" : ""}</option>)}
        </select>
        <button className="btn btn-sm" onClick={startNew}>Crear nuevo a partir de este</button>
        {!isNew && current && !current.builtin && <button className="btn btn-sm" onClick={remove}>Borrar</button>}
      </div>
      {cfg?.description && !isNew && <p className="muted text-sm">{cfg.description}</p>}

      {cfg && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="md:col-span-2 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="sm:col-span-1">
              <label className="label">Nombre</label>
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <Row label="Duración objetivo mínima (s)"><input type="number" min={10} max={170} value={cfg.target_duration?.min ?? 60} onChange={(e) => upd((c) => { c.target_duration = { ...(c.target_duration || { min: 60, max: 120 }), min: Number(e.target.value) }; })} /></Row>
            <Row label="Duración objetivo máxima (s)"><input type="number" min={20} max={180} value={cfg.target_duration?.max ?? 120} onChange={(e) => upd((c) => { c.target_duration = { ...(c.target_duration || { min: 60, max: 120 }), max: Number(e.target.value) }; })} /></Row>
          </div>

          <fieldset className="space-y-2 rounded-lg border p-3" style={{ borderColor: "var(--border)" }}>
            <legend className="px-1 text-sm font-medium">Subtítulos</legend>
            <Row label="Tipografía"><select value={cfg.subtitles.font} onChange={(e) => upd((c) => { c.subtitles.font = e.target.value; })}>{FONTS.map((f) => <option key={f}>{f}</option>)}</select></Row>
            <Row label="Tamaño"><input type="number" min={30} max={140} value={cfg.subtitles.size} onChange={(e) => upd((c) => { c.subtitles.size = Number(e.target.value); })} /></Row>
            <Row label="Color"><input type="color" value={cfg.subtitles.color} onChange={(e) => upd((c) => { c.subtitles.color = e.target.value; })} className="h-9 w-16 p-0" /></Row>
            <Row label="Posición">
              <select value={cfg.subtitles.position || "bottom"} onChange={(e) => upd((c) => { c.subtitles.position = e.target.value as "bottom" | "middle" | "follow"; })}>
                <option value="bottom">Abajo (sobre el margen seguro)</option>
                <option value="middle">Centro de la pantalla</option>
                <option value="follow">Siguen a la persona (bajo el mentón)</option>
              </select>
            </Row>
            <Row label="Modo">
              <select value={cfg.subtitles.words_per_cue || 0} onChange={(e) => upd((c) => { c.subtitles.words_per_cue = Number(e.target.value); })}>
                <option value={0}>Frases (por largo de línea)</option>
                <option value={1}>1 palabra por vez</option>
                <option value={2}>2 palabras por vez</option>
                <option value={3}>3 palabras por vez</option>
              </select>
            </Row>
            <Row label="Líneas"><select value={cfg.subtitles.lines} onChange={(e) => upd((c) => { c.subtitles.lines = Number(e.target.value); })}><option value={1}>1</option><option value={2}>2</option></select></Row>
            <Row label="Caracteres por línea"><input type="number" min={10} max={40} value={cfg.subtitles.max_chars_per_line} onChange={(e) => upd((c) => { c.subtitles.max_chars_per_line = Number(e.target.value); })} /></Row>
            <Check label="Negrita" checked={cfg.subtitles.bold} onChange={(v) => upd((c) => { c.subtitles.bold = v; })} />
            <Check label="Mayúsculas" checked={cfg.subtitles.uppercase} onChange={(v) => upd((c) => { c.subtitles.uppercase = v; })} />
            <Check label="Sombra suave" checked={cfg.subtitles.shadow} onChange={(v) => upd((c) => { c.subtitles.shadow = v; })} />
            <Row label="Contorno (px)"><input type="number" min={0} max={8} value={cfg.subtitles.outline} onChange={(e) => upd((c) => { c.subtitles.outline = Number(e.target.value); })} /></Row>
            <Check label="Caja de fondo" checked={!!cfg.subtitles.box} onChange={(v) => upd((c) => { c.subtitles.box = v; })} />
            {cfg.subtitles.box && (
              <div className="grid grid-cols-2 gap-2">
                <Row label="Color de caja"><input type="color" value={cfg.subtitles.box_color || "#000000"} onChange={(e) => upd((c) => { c.subtitles.box_color = e.target.value; })} className="h-9 w-16 p-0" /></Row>
                <Row label="Opacidad (0-1)"><input type="number" step={0.05} min={0} max={1} value={cfg.subtitles.box_opacity ?? 0.6} onChange={(e) => upd((c) => { c.subtitles.box_opacity = Number(e.target.value); })} /></Row>
              </div>
            )}
            <Check label="Resaltar palabra activa" checked={cfg.subtitles.highlight} onChange={(v) => upd((c) => { c.subtitles.highlight = v; })} />
            {cfg.subtitles.highlight && <Row label="Color de resaltado"><input type="color" value={cfg.subtitles.highlight_color} onChange={(e) => upd((c) => { c.subtitles.highlight_color = e.target.value; })} className="h-9 w-16 p-0" /></Row>}
            <Row label="Animación">
              <select value={cfg.subtitles.animation || "none"} onChange={(e) => upd((c) => { c.subtitles.animation = e.target.value as "none" | "pop"; })}>
                <option value="none">Ninguna</option>
                <option value="pop">Pop (aparece con un rebote chico)</option>
              </select>
            </Row>
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
                  <Check label="Caja de fondo" checked={!!cfg.title.box} onChange={(v) => upd((c) => { c.title.box = v; })} />
                  <Check label="Por detrás de la persona (la persona tapa el título)" checked={!!cfg.title.behind_subject} onChange={(v) => upd((c) => { c.title.behind_subject = v; })} />
                  {cfg.title.behind_subject && cfg.title.permanent && <p className="muted text-xs">Con título permanente, este efecto procesa cada cuadro y el render tarda bastante más.</p>}
                </>
              )}
            </fieldset>

            <fieldset className="space-y-2 rounded-lg border p-3" style={{ borderColor: "var(--border)" }}>
              <legend className="px-1 text-sm font-medium">Ritmo y transiciones</legend>
              <Check label="Saltear pausas largas (jump cuts)" checked={!!cfg.cuts?.remove_silences} onChange={(v) => upd((c) => { c.cuts = { ...(c.cuts || { min_pause_s: 0.7, keep_pause_s: 0.25 }), remove_silences: v }; })} />
              {cfg.cuts?.remove_silences && (
                <div className="grid grid-cols-2 gap-2">
                  <Row label="Pausa mínima a cortar (s)"><input type="number" step={0.05} min={0.3} max={3} value={cfg.cuts.min_pause_s} onChange={(e) => upd((c) => { c.cuts.min_pause_s = Number(e.target.value); })} /></Row>
                  <Row label="Aire que se deja (s)"><input type="number" step={0.05} min={0} max={1} value={cfg.cuts.keep_pause_s} onChange={(e) => upd((c) => { c.cuts.keep_pause_s = Number(e.target.value); })} /></Row>
                </div>
              )}
              <Row label="Transición en cada corte">
                <select value={cfg.transitions || "none"} onChange={(e) => upd((c) => { c.transitions = e.target.value as "none" | "punch" | "flash"; })}>
                  <option value="none">Ninguna (corte limpio)</option>
                  <option value="punch">Punch zoom (acercamiento breve)</option>
                  <option value="flash">Destello blanco</option>
                </select>
              </Row>
              <Check label="Leve zoom al cambiar de hablante" checked={cfg.camera.zoom_on_speaker_change} onChange={(v) => upd((c) => { c.camera.zoom_on_speaker_change = v; })} />
              {(cfg.camera.zoom_on_speaker_change || cfg.transitions === "punch") && <Row label="Intensidad del zoom (1.05–1.3)"><input type="number" step={0.01} min={1.02} max={1.3} value={cfg.camera.zoom_amount} onChange={(e) => upd((c) => { c.camera.zoom_amount = Number(e.target.value); })} /></Row>}
              <Row label="Suavizado del seguimiento (0–0.95)"><input type="number" step={0.05} min={0} max={0.95} value={cfg.camera.smoothing} onChange={(e) => upd((c) => { c.camera.smoothing = Number(e.target.value); })} /></Row>
              <Row label="Dos personas en cámara">
                <select value={cfg.two_speakers} onChange={(e) => upd((c) => { c.two_speakers = e.target.value as "switch" | "split"; })}>
                  <option value="switch">Cambiar según quién habla</option>
                  <option value="split">Dividido arriba/abajo</option>
                </select>
              </Row>
              <Check label="Barra de progreso abajo" checked={!!cfg.progress_bar?.enabled} onChange={(v) => upd((c) => { c.progress_bar = { ...(c.progress_bar || { color: "#FFFFFF", height: 10 }), enabled: v }; })} />
              {cfg.progress_bar?.enabled && (
                <div className="grid grid-cols-2 gap-2">
                  <Row label="Color"><input type="color" value={cfg.progress_bar.color} onChange={(e) => upd((c) => { c.progress_bar.color = e.target.value; })} className="h-9 w-16 p-0" /></Row>
                  <Row label="Alto (px)"><input type="number" min={2} max={40} value={cfg.progress_bar.height} onChange={(e) => upd((c) => { c.progress_bar.height = Number(e.target.value); })} /></Row>
                </div>
              )}
            </fieldset>

            <fieldset className="space-y-2 rounded-lg border p-3" style={{ borderColor: "var(--border)" }}>
              <legend className="px-1 text-sm font-medium">Música de fondo</legend>
              <Check label="Con música" checked={!!cfg.music?.enabled} onChange={(v) => upd((c) => { c.music = { ...(c.music || { track: "random", volume_db: -20, duck: true, fade_out_s: 2 }), enabled: v }; })} />
              {cfg.music?.enabled && (
                <>
                  {tracks.length === 0 && <p className="text-xs text-amber-600">La biblioteca está vacía: subí pistas en la sección Música de esta página. Sin pistas, el clip sale sin música.</p>}
                  <Row label="Pista">
                    <select value={cfg.music.track || "random"} onChange={(e) => upd((c) => { c.music.track = e.target.value; })}>
                      <option value="random">Al azar de la biblioteca</option>
                      {tracks.map((t) => <option key={t.path} value={t.path}>{t.name}</option>)}
                    </select>
                  </Row>
                  <div className="grid grid-cols-2 gap-2">
                    <Row label="Volumen (dB, ej. −20)"><input type="number" min={-40} max={0} value={cfg.music.volume_db} onChange={(e) => upd((c) => { c.music.volume_db = Number(e.target.value); })} /></Row>
                    <Row label="Fade out final (s)"><input type="number" min={0} max={10} value={cfg.music.fade_out_s} onChange={(e) => upd((c) => { c.music.fade_out_s = Number(e.target.value); })} /></Row>
                  </div>
                  <Check label="Bajar la música cuando hay voz (ducking)" checked={cfg.music.duck} onChange={(v) => upd((c) => { c.music.duck = v; })} />
                </>
              )}
            </fieldset>

            <fieldset className="space-y-2 rounded-lg border p-3" style={{ borderColor: "var(--border)" }}>
              <legend className="px-1 text-sm font-medium">Márgenes seguros (px sobre 1080×1920)</legend>
              <div className="grid grid-cols-2 gap-2">
                <Row label="Arriba"><input type="number" value={cfg.safe_area.top} onChange={(e) => upd((c) => { c.safe_area.top = Number(e.target.value); })} /></Row>
                <Row label="Abajo"><input type="number" value={cfg.safe_area.bottom} onChange={(e) => upd((c) => { c.safe_area.bottom = Number(e.target.value); })} /></Row>
                <Row label="Izquierda"><input type="number" value={cfg.safe_area.left} onChange={(e) => upd((c) => { c.safe_area.left = Number(e.target.value); })} /></Row>
                <Row label="Derecha"><input type="number" value={cfg.safe_area.right} onChange={(e) => upd((c) => { c.safe_area.right = Number(e.target.value); })} /></Row>
              </div>
              <p className="muted text-xs">Referencia: Instagram/TikTok tapan ~250 px arriba, ~420 px abajo y ~130 px a la derecha. Los subtítulos "abajo" se apoyan sobre el margen inferior.</p>
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

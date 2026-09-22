import { supabase } from "@/lib/supabase";
import { fail, json } from "@/lib/api";

type Params = { params: Promise<{ id: string }> };

interface PatchBody {
  start_s?: number;
  end_s?: number;
  title?: string;
  subtitle_edits?: Record<string, string>;
  preset_id?: string | null;
}

export async function PATCH(req: Request, { params }: Params) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as PatchBody;
  const db = supabase();
  const { data: clip } = await db.from("clips").select("id, video_id, start_s, end_s, status").eq("id", id).maybeSingle();
  if (!clip) return fail("Clip no encontrado", 404);
  if (clip.status === "rendering" || clip.status === "queued") return fail("El clip se está renderizando; esperá a que termine.");
  const { data: video } = await db.from("videos").select("duration_s").eq("id", clip.video_id).maybeSingle();
  const duration = Number(video?.duration_s || 0);

  const update: Record<string, unknown> = {};
  let start = Number(clip.start_s);
  let end = Number(clip.end_s);
  if (body.start_s != null) start = Number(body.start_s);
  if (body.end_s != null) end = Number(body.end_s);
  if (!isFinite(start) || !isFinite(end)) return fail("Tiempos inválidos.");
  start = Math.max(0, Math.round(start * 100) / 100);
  end = Math.round(end * 100) / 100;
  if (duration > 0) end = Math.min(duration, end);
  if (end - start < 3) return fail("El clip tiene que durar al menos 3 segundos.");
  if (end - start > 180) return fail("El clip no puede superar los 180 segundos.");
  update.start_s = start;
  update.end_s = end;
  if (typeof body.title === "string") update.title = body.title.trim().slice(0, 120);
  if (body.subtitle_edits && typeof body.subtitle_edits === "object") {
    const clean: Record<string, string> = {};
    for (const [k, v] of Object.entries(body.subtitle_edits)) {
      if (typeof v === "string" && /^\d+(\.\d+)?$/.test(k)) clean[k] = v.slice(0, 300);
    }
    update.subtitle_edits = clean;
  }
  if (body.preset_id !== undefined) update.preset_id = body.preset_id || null;
  // Cualquier cambio invalida el render anterior (queda descargable hasta que se vuelva a renderizar).
  const { data, error } = await db.from("clips").update(update).eq("id", id).select("*").single();
  if (error) return fail(error.message, 500);
  return json({ clip: data });
}

export async function DELETE(_req: Request, { params }: Params) {
  const { id } = await params;
  const { error } = await supabase().from("clips").delete().eq("id", id);
  if (error) return fail(error.message, 500);
  return json({ ok: true });
}

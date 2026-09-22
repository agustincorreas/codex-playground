import { enqueueJob, getSetting, supabase } from "@/lib/supabase";
import { fail, json } from "@/lib/api";

type Params = { params: Promise<{ id: string }> };

export async function POST(_req: Request, { params }: Params) {
  const { id } = await params;
  const tokens = await getSetting<{ refresh_token?: string }>("google_tokens");
  if (!tokens?.refresh_token) return fail("Conectá tu cuenta de Google en Configuración para guardar en Drive.");
  const db = supabase();
  const { data: clip } = await db.from("clips").select("id, status, render_path").eq("id", id).maybeSingle();
  if (!clip) return fail("Clip no encontrado", 404);
  if (clip.status !== "ready" || !clip.render_path) return fail("Primero renderizá el clip.");
  await db.from("clips").update({ status_detail: "En cola para Drive", error: null }).eq("id", id);
  await enqueueJob("save_to_drive", { clip_id: id });
  return json({ ok: true });
}

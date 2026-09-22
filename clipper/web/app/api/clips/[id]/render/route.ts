import { enqueueJob, supabase } from "@/lib/supabase";
import { fail, json } from "@/lib/api";

type Params = { params: Promise<{ id: string }> };

export async function POST(_req: Request, { params }: Params) {
  const { id } = await params;
  const db = supabase();
  const { data: clip } = await db.from("clips").select("id, status").eq("id", id).maybeSingle();
  if (!clip) return fail("Clip no encontrado", 404);
  if (clip.status === "rendering" || clip.status === "queued") return fail("Ya se está renderizando.");
  const { error } = await db.from("clips").update({ status: "queued", status_detail: "En cola", error: null }).eq("id", id);
  if (error) return fail(error.message, 500);
  await enqueueJob("render_clip", { clip_id: id });
  return json({ ok: true });
}

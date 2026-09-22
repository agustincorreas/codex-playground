import { enqueueJob, supabase } from "@/lib/supabase";
import { fail, json } from "@/lib/api";

type Params = { params: Promise<{ id: string }> };

/** Vuelve a encolar un video que terminó en error. */
export async function POST(_req: Request, { params }: Params) {
  const { id } = await params;
  const db = supabase();
  const { data: video } = await db.from("videos").select("id, status").eq("id", id).maybeSingle();
  if (!video) return fail("Video no encontrado", 404);
  if (video.status !== "error" && video.status !== "ready") return fail("El video todavía se está procesando.");
  const { error } = await db.from("videos").update({ status: "queued", status_detail: null, error: null }).eq("id", id);
  if (error) return fail(error.message, 500);
  await enqueueJob("process_video", { video_id: id });
  return json({ ok: true });
}

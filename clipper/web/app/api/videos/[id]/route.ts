import { removeObjects, signedUrls, supabase } from "@/lib/supabase";
import { fail, json } from "@/lib/api";
import type { Clip } from "@/lib/types";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  const db = supabase();
  const { data: video, error } = await db
    .from("videos")
    .select("id, created_at, updated_at, source_type, source_url, source_file_id, source_path, source_name, title, duration_s, status, status_detail, error, topics, min_duration_s, max_duration_s, preset_id, language, candidates_count")
    .eq("id", id)
    .maybeSingle();
  if (error) return fail(error.message, 500);
  if (!video) return fail("Video no encontrado", 404);
  const { data: clips } = await db.from("clips").select("*").eq("video_id", id).order("position");
  const list = (clips || []) as Clip[];
  const previews = await signedUrls(list.map((c) => c.preview_path), 3600);
  const thumbs = await signedUrls(list.map((c) => c.thumb_path), 3600);
  const renders = await signedUrls(list.map((c) => c.render_path), 3600);
  list.forEach((c, i) => {
    c.preview_url = previews[i];
    c.thumb_url = thumbs[i];
    c.render_url = renders[i];
  });
  return json({ video, clips: list });
}

export async function DELETE(_req: Request, { params }: Params) {
  const { id } = await params;
  const db = supabase();
  const { data: clips } = await db.from("clips").select("preview_path, thumb_path, render_path").eq("video_id", id);
  const { data: video } = await db.from("videos").select("source_path").eq("id", id).maybeSingle();
  const paths: (string | null)[] = [];
  for (const c of clips || []) paths.push(c.preview_path, c.thumb_path, c.render_path);
  if (video?.source_path) paths.push(video.source_path);
  await removeObjects(paths);
  const { error } = await db.from("videos").delete().eq("id", id);
  if (error) return fail(error.message, 500);
  return json({ ok: true });
}

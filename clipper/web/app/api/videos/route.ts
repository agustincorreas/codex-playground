import { enqueueJob, supabase } from "@/lib/supabase";
import { fail, isYoutubeUrl, json } from "@/lib/api";
import { isDriveUrl, parseDriveId } from "@/lib/google";

export const dynamic = "force-dynamic";

export async function GET() {
  const { data, error } = await supabase()
    .from("videos")
    .select("id, created_at, source_type, source_url, source_name, title, duration_s, status, status_detail, error, topics, min_duration_s, max_duration_s, preset_id, candidates_count")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) return fail(error.message, 500);
  return json({ videos: data });
}

interface CreateBody {
  source_type?: "youtube" | "drive" | "upload";
  url?: string;
  urls?: string[];          // varios links (YouTube o Drive mezclados), uno por video
  drive_file_id?: string;
  drive_file_name?: string;
  upload_path?: string;
  upload_name?: string;
  topics?: string;
  min_duration_s?: number;
  max_duration_s?: number;
  preset_id?: string;
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as CreateBody;
  const minD = Math.max(15, Math.min(180, Math.round(Number(body.min_duration_s) || 60)));
  const maxD = Math.max(minD + 10, Math.min(180, Math.round(Number(body.max_duration_s) || 120)));
  const preset_id = (body.preset_id || "natural").slice(0, 60);
  const topics = (body.topics || "").trim().slice(0, 1000) || null;

  const base: Record<string, unknown> = { topics, min_duration_s: minD, max_duration_s: maxD, preset_id, status: "queued" };

  // Lote: varios links, uno por línea.
  if (Array.isArray(body.urls) && body.urls.length > 0) {
    const urls = body.urls.map((u) => String(u || "").trim()).filter(Boolean);
    if (urls.length === 0) return fail("No hay links válidos.");
    if (urls.length > 30) return fail("Máximo 30 links por vez.");
    const rows: Record<string, unknown>[] = [];
    const invalid: string[] = [];
    for (const u of urls) {
      if (isYoutubeUrl(u)) rows.push({ ...base, source_type: "youtube", source_url: u, title: u });
      else if (isDriveUrl(u) && parseDriveId(u)) rows.push({ ...base, source_type: "drive", source_url: u, source_file_id: parseDriveId(u), title: `Drive ${parseDriveId(u)}` });
      else invalid.push(u);
    }
    if (invalid.length) return fail(`Estos links no son de YouTube ni de Drive: ${invalid.slice(0, 3).join(", ")}${invalid.length > 3 ? "…" : ""}`);
    const { data, error } = await supabase().from("videos").insert(rows).select("id");
    if (error || !data) return fail(error?.message || "No se pudieron crear los videos", 500);
    for (const v of data) await enqueueJob("process_video", { video_id: v.id });
    return json({ ids: data.map((v) => v.id), id: data[0].id, count: data.length });
  }

  const row: Record<string, unknown> = { ...base };
  const url = (body.url || "").trim();
  let source_type = body.source_type;
  if (!source_type) {
    if (body.upload_path) source_type = "upload";
    else if (body.drive_file_id || isDriveUrl(url)) source_type = "drive";
    else source_type = "youtube";
  }

  if (source_type === "youtube") {
    if (!url) return fail("Pegá un link de YouTube.");
    if (!isYoutubeUrl(url)) {
      if (isDriveUrl(url)) return fail("Ese link es de Google Drive; elegí la opción Drive.");
      return fail("El link no parece ser de YouTube (esperaba youtube.com/watch?v=... o youtu.be/...).");
    }
    row.source_type = "youtube";
    row.source_url = url;
    row.title = url;
  } else if (source_type === "drive") {
    const fileId = body.drive_file_id || parseDriveId(url);
    if (!fileId) return fail("No pude sacar el ID de archivo del link de Drive. Pegá el link 'Compartir' del archivo o usá el selector.");
    row.source_type = "drive";
    row.source_url = url || null;
    row.source_file_id = fileId;
    row.source_name = body.drive_file_name || null;
    row.title = body.drive_file_name || `Drive ${fileId}`;
  } else if (source_type === "upload") {
    if (!body.upload_path || !body.upload_path.startsWith("sources/")) return fail("Falta el archivo subido.");
    row.source_type = "upload";
    row.source_path = body.upload_path;
    row.source_name = body.upload_name || null;
    row.title = body.upload_name || "Archivo subido";
  } else {
    return fail("Tipo de origen inválido.");
  }

  const { data, error } = await supabase().from("videos").insert(row).select("id").single();
  if (error || !data) return fail(error?.message || "No se pudo crear el video", 500);
  await enqueueJob("process_video", { video_id: data.id });
  return json({ id: data.id });
}

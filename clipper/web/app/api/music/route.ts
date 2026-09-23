import { BUCKET, supabase } from "@/lib/supabase";
import { fail, json } from "@/lib/api";

export const dynamic = "force-dynamic";

const ALLOWED = /\.(mp3|m4a|wav|aac|ogg|flac)$/i;
const MAX_BYTES = 20 * 1024 * 1024;

/** Biblioteca de música de fondo: archivos en Storage bajo music/. */
export async function GET() {
  const { data, error } = await supabase().storage.from(BUCKET).list("music", { limit: 200, sortBy: { column: "name", order: "asc" } });
  if (error) return fail(error.message, 500);
  const tracks = (data || []).filter((f) => f.id && ALLOWED.test(f.name)).map((f) => ({
    name: f.name,
    path: `music/${f.name}`,
    size: (f.metadata as { size?: number } | null)?.size ?? null,
  }));
  return json({ tracks });
}

export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || typeof file === "string") return fail("Subí un archivo de audio (mp3, m4a, wav, aac, ogg, flac).");
  if (!ALLOWED.test(file.name)) return fail("Formato no soportado. Aceptamos mp3, m4a, wav, aac, ogg y flac.");
  if (file.size > MAX_BYTES) return fail("El archivo supera 20 MB. Usá un mp3 más corto o comprimido.");
  const safe = file.name.replace(/[^\w.-]+/g, "_").slice(-100);
  const { error } = await supabase().storage.from(BUCKET).upload(`music/${safe}`, file, { upsert: true, contentType: file.type || "audio/mpeg" });
  if (error) return fail(error.message, 500);
  return json({ ok: true, path: `music/${safe}` });
}

export async function DELETE(req: Request) {
  const body = await req.json().catch(() => ({}));
  const path = String(body.path || "");
  if (!path.startsWith("music/")) return fail("Ruta inválida.");
  const { error } = await supabase().storage.from(BUCKET).remove([path]);
  if (error) return fail(error.message, 500);
  return json({ ok: true });
}

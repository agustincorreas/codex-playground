import { BUCKET, supabase } from "@/lib/supabase";
import { fail, json } from "@/lib/api";

const ALLOWED = /\.(mp4|mov|m4a|mp3|m4v|mkv|webm)$/i;

/** URL firmada para subir un archivo directo del navegador a Storage (sin pasar por Vercel). */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const name = String(body.name || "archivo.mp4");
  if (!ALLOWED.test(name)) return fail("Formato no soportado. Aceptamos mp4, mov, m4a y mp3.");
  const safe = name.replace(/[^\w.-]+/g, "_").slice(-100);
  const path = `sources/${crypto.randomUUID()}/${safe}`;
  const { data, error } = await supabase().storage.from(BUCKET).createSignedUploadUrl(path);
  if (error || !data) return fail(error?.message || "No se pudo firmar la subida", 500);
  return json({ path, token: data.token, signedUrl: data.signedUrl });
}

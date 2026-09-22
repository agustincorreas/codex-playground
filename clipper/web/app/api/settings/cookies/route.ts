import { BUCKET, supabase } from "@/lib/supabase";
import { fail, json } from "@/lib/api";

export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || typeof file === "string") return fail("Subí un archivo cookies.txt.");
  const text = await file.text();
  if (!/# Netscape HTTP Cookie File|\.youtube\.com/.test(text)) {
    return fail("El archivo no parece un cookies.txt en formato Netscape (exportalo con la extensión 'Get cookies.txt LOCALLY').");
  }
  const { error } = await supabase().storage.from(BUCKET).upload("settings/cookies.txt", new Blob([text], { type: "text/plain" }), { upsert: true });
  if (error) return fail(error.message, 500);
  return json({ ok: true });
}

export async function DELETE() {
  await supabase().storage.from(BUCKET).remove(["settings/cookies.txt"]);
  return json({ ok: true });
}

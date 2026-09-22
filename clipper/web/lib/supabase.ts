import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

export const BUCKET = process.env.STORAGE_BUCKET || "clipper";

/** Cliente de servidor con la service role key. Nunca se expone al navegador. */
export function supabase(): SupabaseClient {
  if (client) return client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY");
  }
  client = createClient(url, key, { auth: { persistSession: false } });
  return client;
}

export async function signedUrl(path: string | null | undefined, expiresIn = 3600, download?: string): Promise<string | null> {
  if (!path) return null;
  const { data, error } = await supabase()
    .storage.from(BUCKET)
    .createSignedUrl(path, expiresIn, download ? { download } : undefined);
  if (error || !data) return null;
  return data.signedUrl;
}

export async function signedUrls(paths: (string | null | undefined)[], expiresIn = 3600): Promise<(string | null)[]> {
  const valid = paths.filter((p): p is string => !!p);
  if (valid.length === 0) return paths.map(() => null);
  const { data, error } = await supabase().storage.from(BUCKET).createSignedUrls(valid, expiresIn);
  if (error || !data) return paths.map(() => null);
  const byPath = new Map(data.map((d) => [d.path, d.signedUrl]));
  return paths.map((p) => (p ? byPath.get(p) ?? null : null));
}

export async function removeObjects(paths: (string | null | undefined)[]): Promise<void> {
  const valid = paths.filter((p): p is string => !!p);
  if (valid.length === 0) return;
  await supabase().storage.from(BUCKET).remove(valid);
}

export async function getSetting<T = unknown>(key: string): Promise<T | null> {
  const { data } = await supabase().from("settings").select("value").eq("key", key).maybeSingle();
  return (data?.value as T) ?? null;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  const { error } = await supabase()
    .from("settings")
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) throw new Error(error.message);
}

export async function enqueueJob(type: "process_video" | "render_clip" | "save_to_drive", ids: { video_id?: string; clip_id?: string }, payload: Record<string, unknown> = {}) {
  const { error } = await supabase().from("jobs").insert({ type, ...ids, payload });
  if (error) throw new Error(error.message);
}

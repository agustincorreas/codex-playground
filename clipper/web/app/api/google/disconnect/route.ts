import { getSetting, supabase } from "@/lib/supabase";
import { json } from "@/lib/api";

export async function POST() {
  const tokens = await getSetting<{ refresh_token?: string }>("google_tokens");
  if (tokens?.refresh_token) {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(tokens.refresh_token)}`, { method: "POST" }).catch(() => null);
  }
  await supabase().from("settings").delete().eq("key", "google_tokens");
  return json({ ok: true });
}

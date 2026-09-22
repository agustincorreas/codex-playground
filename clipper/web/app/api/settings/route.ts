import { BUCKET, getSetting, setSetting, supabase } from "@/lib/supabase";
import { fail, json } from "@/lib/api";
import { googleConfigured } from "@/lib/google";

export const dynamic = "force-dynamic";

export async function GET() {
  const tokens = await getSetting<{ refresh_token?: string; email?: string }>("google_tokens");
  const folder = await getSetting<string>("drive_folder_id");
  const { data: cookies } = await supabase().storage.from(BUCKET).list("settings", { search: "cookies.txt" });
  const cookiesFile = (cookies || []).find((f) => f.name === "cookies.txt");
  const { data: lastJob } = await supabase()
    .from("jobs")
    .select("finished_at, locked_at, status")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return json({
    google_connected: !!tokens?.refresh_token,
    google_email: tokens?.email || null,
    google_configured: googleConfigured(),
    google_picker_ready: !!process.env.NEXT_PUBLIC_GOOGLE_API_KEY,
    drive_folder_id: folder || "",
    cookies_uploaded_at: cookiesFile?.updated_at || cookiesFile?.created_at || null,
    worker_last_activity: lastJob?.finished_at || lastJob?.locked_at || null,
  });
}

export async function PUT(req: Request) {
  const body = await req.json().catch(() => ({}));
  if (typeof body.drive_folder_id === "string") {
    const raw = body.drive_folder_id.trim();
    const m = raw.match(/folders\/([A-Za-z0-9_-]+)/);
    await setSetting("drive_folder_id", m ? m[1] : raw);
  }
  return json({ ok: true });
}

export async function DELETE() {
  return fail("Nada para borrar", 400);
}

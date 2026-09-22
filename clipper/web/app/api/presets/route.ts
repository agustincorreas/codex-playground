import { supabase } from "@/lib/supabase";
import { fail, json } from "@/lib/api";
import type { PresetConfig } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const { data, error } = await supabase().from("presets").select("id, name, builtin, config").order("builtin", { ascending: false }).order("name");
  if (error) return fail(error.message, 500);
  return json({ presets: data });
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "preset";
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const name = String(body.name || "").trim();
  const config = body.config as PresetConfig | undefined;
  if (!name) return fail("Poné un nombre al preset.");
  if (!config || typeof config !== "object" || !config.subtitles) return fail("Config inválida.");
  config.name = name;
  let id = slugify(name);
  const db = supabase();
  const { data: existing } = await db.from("presets").select("id").eq("id", id).maybeSingle();
  if (existing) id = `${id}-${Date.now().toString(36)}`;
  const { data, error } = await db.from("presets").insert({ id, name, builtin: false, config }).select("id, name, builtin, config").single();
  if (error) return fail(error.message, 500);
  return json({ preset: data });
}

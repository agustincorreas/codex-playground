import { supabase } from "@/lib/supabase";
import { fail, json } from "@/lib/api";
import type { PresetConfig } from "@/lib/types";

type Params = { params: Promise<{ id: string }> };

export async function PUT(req: Request, { params }: Params) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const config = body.config as PresetConfig | undefined;
  const name = String(body.name || config?.name || "").trim();
  if (!config || !config.subtitles) return fail("Config inválida.");
  if (name) config.name = name;
  const { data, error } = await supabase()
    .from("presets")
    .update({ name: config.name, config })
    .eq("id", id)
    .select("id, name, builtin, config")
    .single();
  if (error) return fail(error.message, 500);
  return json({ preset: data });
}

export async function DELETE(_req: Request, { params }: Params) {
  const { id } = await params;
  const db = supabase();
  const { data } = await db.from("presets").select("builtin").eq("id", id).maybeSingle();
  if (!data) return fail("Preset no encontrado", 404);
  if (data.builtin) return fail("Los presets de fábrica no se borran (podés editarlos o crear uno nuevo).");
  const { error } = await db.from("presets").delete().eq("id", id);
  if (error) return fail(error.message, 500);
  return json({ ok: true });
}

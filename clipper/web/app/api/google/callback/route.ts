import { NextResponse, type NextRequest } from "next/server";
import { appUrl, exchangeCode, fetchEmail } from "@/lib/google";
import { setSetting } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const err = req.nextUrl.searchParams.get("error");
  const back = (msg?: string) => NextResponse.redirect(`${appUrl()}/settings${msg ? `?google_error=${encodeURIComponent(msg)}` : "?google=ok"}`);
  if (err) return back(`Google devolvió: ${err}`);
  if (!code || !state || state !== req.cookies.get("g_state")?.value) return back("Estado inválido; volvé a intentar.");
  try {
    const tokens = await exchangeCode(code);
    tokens.email = tokens.access_token ? await fetchEmail(tokens.access_token) : undefined;
    await setSetting("google_tokens", tokens);
    const res = back();
    res.cookies.set("g_state", "", { path: "/", maxAge: 0 });
    return res;
  } catch (e) {
    return back(e instanceof Error ? e.message : "Error conectando con Google");
  }
}

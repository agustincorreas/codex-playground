import { NextResponse } from "next/server";
import { authUrl, googleConfigured } from "@/lib/google";
import { fail } from "@/lib/api";

export async function GET() {
  if (!googleConfigured()) return fail("Faltan GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET en Vercel.", 500);
  const state = crypto.randomUUID();
  const res = NextResponse.redirect(authUrl(state));
  res.cookies.set("g_state", state, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 600 });
  return res;
}

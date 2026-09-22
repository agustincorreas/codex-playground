import { NextResponse } from "next/server";
import { SESSION_COOKIE, authEnabled, passwordMatches, sessionToken } from "@/lib/auth";
import { fail, json } from "@/lib/api";

export async function POST(req: Request) {
  if (!authEnabled()) return json({ ok: true });
  const body = await req.json().catch(() => ({}));
  const password = String(body.password || "");
  if (!passwordMatches(password)) return fail("Contraseña incorrecta", 401);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, await sessionToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 90,
  });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}

/** Contraseña única (opcional). Si APP_PASSWORD está vacía, la app queda abierta. */

export const SESSION_COOKIE = "clipper_session";

function enc(s: string) {
  return new TextEncoder().encode(s);
}

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc(message));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function authEnabled(): boolean {
  return !!process.env.APP_PASSWORD;
}

export async function sessionToken(): Promise<string> {
  const secret = process.env.APP_SECRET || process.env.APP_PASSWORD || "clipper";
  return hmac(secret, "session:" + (process.env.APP_PASSWORD || ""));
}

export async function isValidSession(cookieValue: string | undefined): Promise<boolean> {
  if (!authEnabled()) return true;
  if (!cookieValue) return false;
  return cookieValue === (await sessionToken());
}

export function passwordMatches(input: string): boolean {
  const expected = process.env.APP_PASSWORD || "";
  if (input.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < input.length; i++) diff |= input.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

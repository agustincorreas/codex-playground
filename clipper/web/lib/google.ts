import { getSetting, setSetting } from "./supabase";

export const DRIVE_SCOPES = ["https://www.googleapis.com/auth/drive.file"];

export interface GoogleTokens {
  refresh_token: string;
  access_token?: string;
  expires_at?: number; // epoch segundos
  email?: string;
}

export function googleConfigured(): boolean {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function appUrl(): string {
  return (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
}

export function redirectUri(): string {
  return `${appUrl()}/api/google/callback`;
}

export function authUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID || "",
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: DRIVE_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function exchangeCode(code: string): Promise<GoogleTokens> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID || "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
      redirect_uri: redirectUri(),
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new Error(`Google no aceptó el código (${res.status}): ${await res.text()}`);
  const data = await res.json();
  if (!data.refresh_token) {
    throw new Error("Google no devolvió refresh_token. Revocá el acceso de la app en tu cuenta de Google y volvé a conectar.");
  }
  return {
    refresh_token: data.refresh_token,
    access_token: data.access_token,
    expires_at: Math.floor(Date.now() / 1000) + Number(data.expires_in || 3600),
  };
}

export async function getAccessToken(): Promise<string | null> {
  const tokens = await getSetting<GoogleTokens>("google_tokens");
  if (!tokens?.refresh_token) return null;
  const now = Math.floor(Date.now() / 1000);
  if (tokens.access_token && (tokens.expires_at || 0) > now + 60) return tokens.access_token;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID || "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
      refresh_token: tokens.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  const updated: GoogleTokens = {
    ...tokens,
    access_token: data.access_token,
    expires_at: now + Number(data.expires_in || 3600),
  };
  await setSetting("google_tokens", updated);
  return updated.access_token || null;
}

export async function fetchEmail(accessToken: string): Promise<string | undefined> {
  try {
    const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return undefined;
    const data = await res.json();
    return data.email;
  } catch {
    return undefined;
  }
}

export function parseDriveId(input: string): string | null {
  const text = (input || "").trim();
  const patterns = [/\/file\/d\/([A-Za-z0-9_-]{10,})/, /[?&]id=([A-Za-z0-9_-]{10,})/, /^([A-Za-z0-9_-]{20,})$/];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return m[1];
  }
  return null;
}

export function isDriveUrl(input: string): boolean {
  return /drive\.google\.com|docs\.google\.com/.test(input || "");
}

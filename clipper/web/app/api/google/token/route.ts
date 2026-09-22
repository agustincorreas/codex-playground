import { getAccessToken } from "@/lib/google";
import { fail, json } from "@/lib/api";

/** Access token de corta duración para el Google Picker (solo alcance drive.file). */
export async function GET() {
  const token = await getAccessToken();
  if (!token) return fail("Google Drive no está conectado.", 401);
  return json({ access_token: token });
}

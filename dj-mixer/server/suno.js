// Suno: metadatos públicos (temas, playlists, perfiles) y biblioteca personal vía la sesión del usuario (cookie __client de suno.com).
const API = 'https://studio-api.prod.suno.com';
const CLERK = 'https://clerk.suno.com';
const CLERK_V = '5.35.0';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36';

export function createSuno(getCfg) {
  let token = null, tokenAt = 0, sessionId = null;

  const clientCookie = () => (getCfg().sunoClient || '').trim();
  async function jwt() {
    const c = clientCookie(); if (!c) return null;
    if (token && Date.now() - tokenAt < 50_000) return token;
    const headers = { Cookie: `__client=${c}`, 'User-Agent': UA, Origin: 'https://suno.com', Referer: 'https://suno.com/' };
    if (!sessionId) {
      const r = await fetch(`${CLERK}/v1/client?_clerk_js_version=${CLERK_V}`, { headers });
      if (!r.ok) throw new Error(`Suno: la cookie __client no es válida (Clerk ${r.status}). Copiala de nuevo desde suno.com.`);
      const j = await r.json();
      sessionId = j?.response?.last_active_session_id || j?.response?.sessions?.[0]?.id || null;
      if (!sessionId) throw new Error('Suno: no hay una sesión activa para esa cookie. Iniciá sesión en suno.com y copiá __client otra vez.');
    }
    const r = await fetch(`${CLERK}/v1/client/sessions/${sessionId}/tokens?_clerk_js_version=${CLERK_V}`, { method: 'POST', headers });
    if (!r.ok) { sessionId = null; throw new Error(`Suno: no se pudo renovar el token (${r.status}). Volvé a copiar la cookie __client.`); }
    const j = await r.json(); token = j.jwt; tokenAt = Date.now();
    if (!token) throw new Error('Suno: Clerk no devolvió token.');
    return token;
  }
  async function api(path, { auth = 'auto' } = {}) {
    const headers = { 'User-Agent': UA, Accept: 'application/json' };
    let t = null;
    if (auth === true || auth === 'auto') { try { t = await jwt(); } catch (e) { if (auth === true) throw e; } }
    if (t) headers.Authorization = `Bearer ${t}`;
    const r = await fetch(API + path, { headers });
    if (!r.ok) { let d = ''; try { d = (await r.json()).detail || ''; } catch { /* sin cuerpo */ } throw new Error(`Suno API ${r.status}${d ? ': ' + (typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 120) : ''}`); }
    return r.json();
  }
  const playable = (c) => !!(c.audio_url && !/forbidden/.test(c.audio_url));
  const mapClip = (c) => ({
    id: c.id, title: c.title || 'Sin título', artist: c.display_name || c.handle || 'Suno', duration: c.metadata?.duration || null,
    cover: c.image_url || null, url: `https://suno.com/song/${c.id}`, tags: c.metadata?.tags || '', playable: playable(c), isPublic: !!c.is_public,
  });
  const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

  return {
    hasSession: () => !!clientCookie(),
    async clip(id) { return mapClip(await api(`/api/clip/${id}`)); },
    async clipRaw(id) { return api(`/api/clip/${id}`); },
    async playlist(id) {
      const out = []; let name = ''; let page = 1;
      for (;;) {
        const j = await api(`/api/playlist/${id}/?page=${page}`); name = j.name || name;
        const items = (j.playlist_clips || []).map(pc => mapClip(pc.clip)); out.push(...items);
        if (!items.length || items.length < 20 || page >= 10) break; page++;
      }
      return { name, tracks: out };
    },
    async profile(handle) {
      const j = await api(`/api/profiles/${encodeURIComponent(handle.replace(/^@/, ''))}?playlists_sort_by=created_at&clips_sort_by=created_at&page=1`);
      return { name: j.display_name || handle, tracks: (j.clips || []).map(mapClip), total: j.num_total_clips };
    },
    async me(page = 0) {
      const j = await api(`/api/feed/v2?page=${page}`, { auth: true });
      const clips = Array.isArray(j) ? j : (j.clips || []);
      return { tracks: clips.filter(c => c.status === 'complete').map(mapClip), hasMore: clips.length >= 20 };
    },
    async resolve(input) {
      const s = (input || '').trim();
      const m = s.match(UUID);
      if (/\/song\//.test(s) && m) return { kind: 'song', tracks: [await this.clip(m[0])] };
      if (/\/playlist\//.test(s) && m) { const p = await this.playlist(m[0]); return { kind: 'playlist', name: p.name, tracks: p.tracks }; }
      const h = s.match(/suno\.com\/@([\w.-]+)/) || s.match(/^@([\w.-]+)$/);
      if (h) { const p = await this.profile(h[1]); return { kind: 'profile', name: p.name, tracks: p.tracks }; }
      if (m) return { kind: 'song', tracks: [await this.clip(m[0])] };
      throw new Error('Pegá un link de tema, playlist o perfil de Suno (suno.com/song/…, /playlist/…, /@usuario)');
    },
    async audioUrl(id) {
      const c = await this.clipRaw(id);
      if (!playable(c)) throw new Error('Suno no entrega el audio de este tema fuera de su reproductor. Si es tuyo, descargalo desde Suno y agregalo como archivo.');
      return c.audio_url;
    },
    ua: UA,
  };
}

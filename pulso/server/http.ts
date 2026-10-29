// Ayudas puras del servidor HTTP: quién puede entrar (la propia computadora, o el celular con el token de
// la dirección que da la app), el mismo origen, y rutas de archivos estáticos sin escaparse de `dist`.
import type { IncomingMessage } from 'node:http';
import { isAbsolute, join, normalize, relative, sep } from 'node:path';

export interface ReqLike {
  headers: IncomingMessage['headers'];
  socket?: { remoteAddress?: string };
  url?: string;
}

/** La conexión viene de esta misma computadora. */
export function isLoopback(req: ReqLike): boolean {
  const a = req.socket?.remoteAddress ?? '';
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
}

/** El token que trae el pedido: `?t=`, `Authorization: Bearer` o la cookie que deja la primera visita. */
export function tokenOf(req: ReqLike): string | undefined {
  try {
    const url = new URL(req.url ?? '/', 'http://x');
    const t = url.searchParams.get('t');
    if (t) return t;
  } catch {
    // URL rara: sin token por la query.
  }
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) return auth.slice(7).trim();
  const cookie = req.headers.cookie ?? '';
  const m = /(?:^|;\s*)pulso_t=([^;]+)/.exec(cookie);
  return m ? decodeURIComponent(m[1]) : undefined;
}

/**
 * Si el navegador manda `Origin`, tiene que ser el mismo host al que le habla: así una página ajena abierta
 * en el navegador no puede usar el servidor local (ni por WebSocket, que no tiene CORS).
 */
export function sameOrigin(req: ReqLike): boolean {
  const o = req.headers.origin;
  if (!o || o === 'null') return !o;
  try {
    return new URL(o).host === (req.headers.host ?? '');
  } catch {
    return false;
  }
}

/** Entra si es la propia computadora o si trae el token (y siempre con el mismo origen). Sin token, solo la propia. */
export function authorized(req: ReqLike, token: string | undefined): boolean {
  return sameOrigin(req) && (isLoopback(req) || (!!token && tokenOf(req) === token));
}

/** Token aleatorio para la dirección del celular cuando no se configuró uno. */
export function randomToken(): string {
  const abc = 'abcdefghijkmnpqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < 20; i++) out += abc[Math.floor(Math.random() * abc.length)];
  return out;
}

/** Archivo dentro de `dist` para una ruta del pedido, o null si se escapa o no se puede decodificar. */
export function staticPath(dist: string, rawPath: string): string | null {
  let path: string;
  try {
    path = decodeURIComponent(rawPath.split('?')[0]);
  } catch {
    return null;
  }
  const file = normalize(join(dist, path));
  const rel = relative(dist, file);
  if (rel.startsWith('..') || isAbsolute(rel)) return null;
  return file;
}

/** ¿Es un archivo de `dist/assets` (con hash en el nombre: se puede cachear para siempre)? */
export function isAsset(dist: string, file: string): boolean {
  return relative(dist, file).startsWith(`assets${sep}`);
}

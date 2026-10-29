// Quién entra al servidor y qué archivos se sirven.
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { authorized, isAsset, isLoopback, sameOrigin, staticPath, tokenOf } from '../server/http';

const req = (o: { ip?: string; url?: string; headers?: Record<string, string> } = {}) => ({ headers: o.headers ?? {}, socket: { remoteAddress: o.ip ?? '192.168.1.20' }, url: o.url ?? '/' });

describe('acceso al servidor', () => {
  it('la propia computadora entra sin token; el celular, solo con el token (query, cabecera o cookie)', () => {
    expect(isLoopback(req({ ip: '127.0.0.1' }))).toBe(true);
    expect(isLoopback(req({ ip: '::ffff:127.0.0.1' }))).toBe(true);
    expect(authorized(req({ ip: '127.0.0.1' }), 'abc')).toBe(true);
    expect(authorized(req(), 'abc')).toBe(false);
    expect(authorized(req({ url: '/?t=abc' }), 'abc')).toBe(true);
    expect(authorized(req({ headers: { authorization: 'Bearer abc' } }), 'abc')).toBe(true);
    expect(authorized(req({ headers: { cookie: 'x=1; pulso_t=abc' } }), 'abc')).toBe(true);
    expect(tokenOf(req({ url: '/ws?t=zzz' }))).toBe('zzz');
    expect(authorized(req({ url: '/?t=otro' }), 'abc')).toBe(false);
  });

  it('una página ajena (otro origen) no entra ni desde la propia computadora', () => {
    expect(sameOrigin(req({ headers: { host: '127.0.0.1:8787', origin: 'http://127.0.0.1:8787' } }))).toBe(true);
    expect(sameOrigin(req({ headers: { host: '127.0.0.1:8787', origin: 'https://malo.example' } }))).toBe(false);
    expect(sameOrigin(req({ headers: { host: '127.0.0.1:8787', origin: 'null' } }))).toBe(false);
    expect(authorized(req({ ip: '127.0.0.1', headers: { host: '127.0.0.1:8787', origin: 'https://malo.example' } }), 'abc')).toBe(false);
  });

  it('los archivos estáticos no se escapan de dist ni rompen con rutas mal escritas', () => {
    const dist = join('/srv', 'dist');
    expect(staticPath(dist, '/assets/a.js?v=1')).toBe(join(dist, 'assets', 'a.js'));
    expect(staticPath(dist, '/%')).toBeNull();
    expect(staticPath(dist, '/../dist-demo/index.html')).toBeNull();
    expect(staticPath(dist, '/..%2f.env')).toBeNull();
    expect(isAsset(dist, join(dist, 'assets', 'a.js'))).toBe(true);
    expect(isAsset(dist, join(dist, 'index.html'))).toBe(false);
  });
});

// Claves de la app de escritorio en el almacenamiento seguro: en el archivo van cifradas (`enc:…`), en
// memoria en claro; lo que estaba en claro se migra; sin almacén se sigue en claro.
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

type Store = { available: () => boolean; encrypt: (s: string) => Buffer; decrypt: (b: Buffer) => string };
const secrets = createRequire(import.meta.url)('../desktop/secrets.cjs') as {
  SECRET_FIELDS: string[];
  isSealed: (v: unknown) => boolean;
  sealSettings: (s: Record<string, unknown>, store: Store) => Record<string, unknown>;
  openSettings: (s: Record<string, unknown>, store: Store) => { settings: Record<string, unknown>; migrate: boolean; failed: string[] };
  electronStore: (ss: unknown, platform?: string) => Store;
};

/** Un "llavero" de juguete: invierte el texto y lo marca para distinguirlo del claro. */
const fake = (available = true): Store => ({
  available: () => available,
  encrypt: (s) => Buffer.from('K' + [...s].reverse().join('')),
  decrypt: (b) => {
    const t = b.toString();
    if (!t.startsWith('K')) throw new Error('no es mío');
    return [...t.slice(1)].reverse().join('');
  },
});

const plain = { alpacaKey: 'PKabc', alpacaSecret: 'secreto', massiveKey: '', anthropicKey: 'sk-ant-1', lan: true, token: 'abcdefghijklmnop' };

describe('claves de la app de escritorio', () => {
  it('cifra solo las claves (no el resto), y nunca dos veces', () => {
    const store = fake();
    const sealed = secrets.sealSettings(plain, store);
    for (const f of ['alpacaKey', 'alpacaSecret', 'anthropicKey']) expect(secrets.isSealed(sealed[f])).toBe(true);
    expect(sealed.massiveKey).toBe('');
    expect(sealed.token).toBe(plain.token);
    expect(sealed.lan).toBe(true);
    expect(secrets.sealSettings(sealed, store)).toEqual(sealed);
    expect(JSON.stringify(sealed)).not.toContain('secreto');
  });

  it('descifra al leer y no pide migración si ya estaba cifrado', () => {
    const store = fake();
    const sealed = secrets.sealSettings(plain, store);
    const { settings, migrate, failed } = secrets.openSettings(sealed, store);
    expect(settings).toEqual(plain);
    expect(migrate).toBe(false);
    expect(failed).toEqual([]);
  });

  it('con claves en claro y almacén disponible pide migrar; sin almacén sigue en claro', () => {
    expect(secrets.openSettings(plain, fake()).migrate).toBe(true);
    const sin = secrets.openSettings(plain, fake(false));
    expect(sin.migrate).toBe(false);
    expect(sin.settings).toEqual(plain);
    expect(secrets.sealSettings(plain, fake(false))).toEqual(plain);
  });

  it('lo que no se puede descifrar queda vacío y se informa (cambió el llavero)', () => {
    const sealed = secrets.sealSettings(plain, fake());
    const otro: Store = { ...fake(), decrypt: () => { throw new Error('otro usuario'); } };
    const { settings, failed } = secrets.openSettings(sealed, otro);
    expect(failed.sort()).toEqual(['alpacaKey', 'alpacaSecret', 'anthropicKey']);
    expect(settings.alpacaSecret).toBe('');
    expect(settings.token).toBe(plain.token);
    // Sin almacén pero con valores cifrados: tampoco se pueden leer.
    expect(secrets.openSettings(sealed, fake(false)).failed.length).toBe(3);
  });

  it('en Linux el backend basic_text no cuenta como cifrado', () => {
    const ss = { isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'basic_text', encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() };
    expect(secrets.electronStore(ss, 'linux').available()).toBe(false);
    expect(secrets.electronStore(ss, 'darwin').available()).toBe(true);
    expect(secrets.electronStore({ ...ss, getSelectedStorageBackend: () => 'gnome_libsecret' }, 'linux').available()).toBe(true);
    expect(secrets.electronStore({ ...ss, isEncryptionAvailable: () => { throw new Error('antes de ready'); } }, 'win32').available()).toBe(false);
  });
});

// Claves en el almacenamiento seguro del sistema: en el archivo de ajustes (pulso.json) las claves van
// cifradas con `safeStorage` de Electron (llavero de Mac, DPAPI en Windows, el llavero del escritorio en
// Linux) como `enc:<base64>`. En memoria y hacia el servidor hijo (solo por variables de entorno) van en
// claro. El "almacén" se inyecta para poder probarlo sin Electron.
const SECRET_FIELDS = ['alpacaKey', 'alpacaSecret', 'massiveKey', 'anthropicKey'];
const PREFIX = 'enc:';

/** ¿Es un valor que ya está cifrado en el archivo? */
function isSealed(v) {
  return typeof v === 'string' && v.startsWith(PREFIX);
}

/**
 * Ajustes listos para escribir en el archivo: las claves cifradas si el almacén está disponible; si no,
 * en claro (Linux sin llavero). Nunca cifra dos veces.
 */
function sealSettings(s, store) {
  const out = { ...s };
  if (!store.available()) return out;
  for (const f of SECRET_FIELDS) {
    const v = out[f];
    if (typeof v !== 'string' || !v || isSealed(v)) continue;
    out[f] = PREFIX + store.encrypt(v).toString('base64');
  }
  return out;
}

/**
 * Ajustes leídos del archivo, con las claves en claro. Devuelve también si había claves en claro que
 * convendría reescribir cifradas (`migrate`) y las que no se pudieron descifrar (`failed`: cambió el
 * usuario o el llavero; se tratan como vacías para que la ventana de claves las vuelva a pedir).
 */
function openSettings(s, store) {
  const out = { ...s };
  const available = store.available();
  let migrate = false;
  const failed = [];
  for (const f of SECRET_FIELDS) {
    const v = out[f];
    if (typeof v !== 'string' || !v) continue;
    if (!isSealed(v)) {
      if (available) migrate = true;
      continue;
    }
    try {
      if (!available) throw new Error('sin almacén');
      out[f] = store.decrypt(Buffer.from(v.slice(PREFIX.length), 'base64'));
    } catch {
      out[f] = '';
      failed.push(f);
    }
  }
  return { settings: out, migrate, failed };
}

/** Almacén sobre `safeStorage` de Electron (solo después de `app.whenReady()`). */
function electronStore(safeStorage, platform = process.platform) {
  return {
    available() {
      try {
        if (!safeStorage.isEncryptionAvailable()) return false;
        // En Linux, "basic_text" no es cifrado real (clave fija): mejor dejar las claves en claro y avisar.
        if (platform === 'linux' && typeof safeStorage.getSelectedStorageBackend === 'function' && safeStorage.getSelectedStorageBackend() === 'basic_text') return false;
        return true;
      } catch {
        return false;
      }
    },
    encrypt: (text) => safeStorage.encryptString(text),
    decrypt: (buf) => safeStorage.decryptString(buf),
  };
}

module.exports = { SECRET_FIELDS, PREFIX, isSealed, sealSettings, openSettings, electronStore };

// localStorage tolerante a fallos (modo privado, almacenamiento bloqueado, vistas previas).
const PREFIX = 'pulso:';

export function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw === null) return fallback;
    const parsed = JSON.parse(raw);
    if (fallback && typeof fallback === 'object' && !Array.isArray(fallback)) return { ...fallback, ...parsed };
    return parsed as T;
  } catch {
    return fallback;
  }
}

export function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Sin almacenamiento: la app sigue funcionando, solo no recuerda la preferencia.
  }
}

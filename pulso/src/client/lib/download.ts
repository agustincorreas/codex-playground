// Descargar un archivo generado por la página: en Claude, con el permiso de descargas del artifact; si
// no, con un enlace temporal del navegador.
export async function downloadText(filename: string, data: string, type: string): Promise<boolean> {
  const claude = (window as unknown as { claude?: { use(n: string): Promise<unknown> } }).claude;
  const dl = claude?.use ? ((await claude.use('downloads').catch(() => null)) as { save(f: { filename: string; data: string }): Promise<unknown> } | null) : null;
  if (dl) {
    try {
      await dl.save({ filename, data });
      return true;
    } catch {
      return false;
    }
  }
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}

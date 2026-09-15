// Lector mínimo de etiquetas ID3v2 (título, artista, álbum, BPM, tonalidad, carátula).
const syncsafe = (b, i) => ((b[i] & 0x7f) << 21) | ((b[i + 1] & 0x7f) << 14) | ((b[i + 2] & 0x7f) << 7) | (b[i + 3] & 0x7f);
const FRAMES = { TIT2: 'title', TT2: 'title', TPE1: 'artist', TP1: 'artist', TALB: 'album', TAL: 'album', TBPM: 'bpm', TBP: 'bpm', TKEY: 'key', TKE: 'key' };

function decodeText(bytes) {
  if (!bytes.length) return '';
  const enc = bytes[0], body = bytes.subarray(1);
  let s;
  try {
    if (enc === 0) s = new TextDecoder('latin1').decode(body);
    else if (enc === 1) s = new TextDecoder('utf-16').decode(body);
    else if (enc === 2) s = new TextDecoder('utf-16be').decode(body);
    else s = new TextDecoder('utf-8').decode(body);
  } catch { s = ''; }
  return s.replace(/\0+$/g, '').replace(/\0/g, ' / ').trim();
}

export async function readId3(file) {
  const out = {};
  try {
    const head = new Uint8Array(await file.slice(0, 10).arrayBuffer());
    if (head[0] !== 0x49 || head[1] !== 0x44 || head[2] !== 0x33) return out;
    const ver = head[3], size = syncsafe(head, 6);
    const b = new Uint8Array(await file.slice(10, 10 + Math.min(size, 4 * 1024 * 1024)).arrayBuffer());
    let i = 0;
    const hdr = ver === 2 ? 6 : 10;
    while (i + hdr <= b.length) {
      const id = String.fromCharCode(...b.subarray(i, i + (ver === 2 ? 3 : 4)));
      if (!/^[A-Z0-9]+$/.test(id)) break;
      const len = ver === 2 ? (b[i + 3] << 16) | (b[i + 4] << 8) | b[i + 5] : ver === 4 ? syncsafe(b, i + 4) : (b[i + 4] << 24) | (b[i + 5] << 16) | (b[i + 6] << 8) | b[i + 7];
      const body = b.subarray(i + hdr, i + hdr + len);
      if (FRAMES[id]) out[FRAMES[id]] = decodeText(body);
      else if ((id === 'APIC' || id === 'PIC') && !out.cover) {
        let p = 1; let mime = '';
        if (ver === 2) { mime = String.fromCharCode(...body.subarray(1, 4)); p = 4; mime = mime === 'JPG' ? 'image/jpeg' : 'image/' + mime.toLowerCase(); }
        else { while (p < body.length && body[p] !== 0) p++; mime = new TextDecoder('latin1').decode(body.subarray(1, p)); p++; }
        p++; // picture type
        const enc = body[0];
        if (enc === 1 || enc === 2) { while (p + 1 < body.length && !(body[p] === 0 && body[p + 1] === 0)) p += 2; p += 2; }
        else { while (p < body.length && body[p] !== 0) p++; p++; }
        out.cover = URL.createObjectURL(new Blob([body.subarray(p)], { type: mime || 'image/jpeg' }));
      }
      i += hdr + len;
      if (len <= 0) break;
    }
    if (out.bpm) { const n = parseFloat(out.bpm); out.bpm = isFinite(n) && n > 0 ? n : null; }
  } catch { /* archivo sin tags */ }
  return out;
}

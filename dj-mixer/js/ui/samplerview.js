import { el, toast } from '../utils.js';
import { knob, button } from './components.js';
import { store } from '../store.js';

export const PAD_KEYS = ['Z', 'X', 'C', 'V', 'B', 'N', 'M', ','];

export class SamplerView {
  constructor(sampler, root) {
    this.sampler = sampler; this.root = root; this.pads = [];
    sampler.onChange = (i) => this.refresh(i);
    const padsEl = el('div', { class: 'pads' });
    const file = el('input', { type: 'file', accept: 'audio/*', hidden: '' });
    file.addEventListener('change', async () => { if (file.files[0] && this._loadTo != null) { try { await sampler.loadFile(this._loadTo, file.files[0]); toast('Sample cargado'); } catch { toast('No se pudo leer el archivo', 'error'); } } file.value = ''; });
    for (let i = 0; i < 8; i++) {
      const b = button({ label: '', cls: 'pad', action: `smp.pad${i + 1}`, title: `Click: disparar · Shift+click: cargar archivo · Alt+click: restaurar · Ctrl+click: parar · Tecla ${PAD_KEYS[i]}`,
        onPress: (e) => { if (e?.shiftKey) { this._loadTo = i; file.click(); } else if (e?.altKey) sampler.restoreDefault(i); else if (e?.ctrlKey || e?.metaKey) sampler.stop(i); else sampler.trigger(i); } });
      b.el.innerHTML = `<span class="pad-key">${PAD_KEYS[i]}</span><span class="pad-name"></span>`;
      b.el.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('Files') || e.dataTransfer.types.includes('text/x-track')) { e.preventDefault(); b.el.classList.add('drop'); } });
      b.el.addEventListener('dragleave', () => b.el.classList.remove('drop'));
      b.el.addEventListener('drop', async e => {
        b.el.classList.remove('drop'); e.preventDefault(); e.stopPropagation();
        const f = e.dataTransfer.files?.[0]; const id = e.dataTransfer.getData('text/x-track');
        const track = id ? window.mixr?.library.byId(id) : null;
        const src = f || track?.file; if (!src) return toast('Soltá un archivo de audio o una pista local', 'warn');
        try { await sampler.loadFile(i, src); toast('Sample cargado'); } catch { toast('No se pudo leer el archivo', 'error'); }
      });
      this.pads.push(b); padsEl.append(b.el);
    }
    this.vol = knob({ label: 'VOL', min: 0, max: 1.25, def: 0.9, value: sampler.volume, bipolar: false, size: 34, action: 'smp.volume', fmt: v => `${Math.round(v * 100)}%`, onChange: v => sampler.setVolume(v) });
    this.$q = button({ label: 'Q', cls: 'sm', action: 'smp.quantize', title: 'Cuantizar los pads al beat del deck que suena', onPress: () => { sampler.quantize = !sampler.quantize; this.$q.set(sampler.quantize); } });
    this.$cue = button({ label: '🎧', cls: 'sm cue-btn', action: 'smp.cue', title: 'Escuchar el sampler en auriculares', onPress: () => { this._cue = !this._cue; sampler.setCue(this._cue); this.$cue.set(this._cue); } });
    this.$stop = button({ label: '■', cls: 'sm', action: 'smp.stop', title: 'Parar todos los samples', onPress: () => sampler.stopAll() });
    this.collapsed = store.get('samplerCollapsed', false);
    this.$toggle = el('button', { class: 'btn xs ghost', type: 'button' }, '');
    this.$toggle.addEventListener('click', () => { this.collapsed = !this.collapsed; store.set('samplerCollapsed', this.collapsed); this.applyCollapse(); });
    root.append(el('div', { class: 'smp-head' }, el('span', { class: 'row-label' }, 'SAMPLER'), this.$toggle), padsEl, el('div', { class: 'smp-ctl' }, this.$q.el, this.$cue.el, this.$stop.el, this.vol.el), file);
    this.$pads = padsEl;
    this.applyCollapse();
    for (let i = 0; i < 8; i++) this.refresh(i);
  }
  applyCollapse() { this.root.classList.toggle('collapsed', this.collapsed); this.$toggle.textContent = this.collapsed ? '▸ Mostrar' : '▾ Ocultar'; }
  refresh(i) {
    const p = this.sampler.pads[i], b = this.pads[i];
    b.el.style.setProperty('--pad', p.color); b.el.querySelector('.pad-name').textContent = p.name;
    b.el.classList.toggle('empty', !p.buffer); b.el.classList.toggle('custom', p.custom); b.set(!!p.playing);
  }
}

import { el, fmtTime, fmtBpm, fmtPct, toast } from '../utils.js';
import { knob, fader, button } from './components.js';
import { OverviewWave, HOTCUE_COLORS } from './waveform.js';

export class DeckView {
  constructor(deck, root, { color, onDropTrack, onSync }) {
    this.deck = deck; this.root = root; this.color = color; this.onDropTrack = onDropTrack; this.onSync = onSync;
    this.angle = 0; this._last = performance.now();
    this.build();
    deck.on('loaded', () => this.onLoaded()).on('state', () => this.refresh()).on('rate', () => this.refreshRate())
      .on('ejected', () => this.onLoaded()).on('error', (e) => { toast(`Deck ${deck.id}: ${e.message || e}`, 'error', 5000); this.refresh(); })
      .on('loading', () => { this.root.classList.add('loading'); this.$title.textContent = 'Cargando…'; });
  }
  build() {
    const d = this.deck, id = d.id, r = this.root; r.style.setProperty('--deck', this.color);
    const a = (n) => `${id}.${n}`;
    // cabecera
    this.$art = el('div', { class: 'art' });
    this.$title = el('div', { class: 'title' }, 'Sin pista');
    this.$artist = el('div', { class: 'artist' }, `Deck ${id}`);
    this.$bpm = el('span', { class: 'bpm', title: 'Click: tap tempo · Doble click: editar BPM' }, '--.-');
    this.$bpm.addEventListener('click', () => d.tapTempo());
    this.$bpm.addEventListener('dblclick', () => { const v = parseFloat(prompt('BPM', d.bpm || '')); if (v) d.setBpm(v); });
    this.$time = el('span', { class: 'time' }, '00:00.0');
    this.$remain = el('span', { class: 'remain' }, '-00:00.0');
    this.$pitchTxt = el('span', { class: 'pitch-txt' }, '+0.00%');
    this.$eject = button({ label: '⏏', cls: 'ghost sm eject', title: 'Expulsar', onPress: () => d.eject() });
    const head = el('div', { class: 'deck-head' }, this.$art,
      el('div', { class: 'meta' }, this.$title, this.$artist),
      el('div', { class: 'numbers' }, el('div', {}, this.$bpm, el('small', {}, ' BPM')), el('div', {}, this.$time), el('div', { class: 'muted' }, this.$remain), el('div', { class: 'muted' }, this.$pitchTxt)),
      this.$eject.el);
    this.$overview = el('canvas', { class: 'overview' });
    this.$overview.addEventListener('pointerdown', (e) => { if (!d.loaded) return; const rc = this.$overview.getBoundingClientRect(); d.seek((e.clientX - rc.left) / rc.width * d.duration); });
    this.overview = new OverviewWave(this.$overview, d, this.color);
    // platter + video
    this.$disc = el('div', { class: 'platter-disc' }, el('i', { class: 'marker' }), el('span', { class: 'platter-label' }, id));
    this.$video = el('div', { class: 'video-host' });
    d.videoHost = this.$video;
    this.$platter = el('div', { class: 'platter', dataset: { action: a('jog') } }, this.$disc, this.$video);
    this._platterDrag();
    // hot cues
    this.hotBtns = [];
    const hot = el('div', { class: 'hotcues' });
    for (let i = 0; i < 8; i++) {
      const b = button({ label: String(i + 1), cls: `hot ${i >= 4 ? 'expert-only' : ''}`, action: a(`hotcue${i + 1}`), title: 'Click: fijar/saltar · Shift+click: borrar',
        onPress: (e) => e?.shiftKey ? d.deleteHotcue(i) : d.hotcue(i) });
      b.el.style.setProperty('--hc', HOTCUE_COLORS[i]); this.hotBtns.push(b); hot.append(b.el);
    }
    // loops
    this.loopBtns = {};
    const loops = el('div', { class: 'loops' });
    for (const n of [1, 2, 4, 8, 16]) { const b = button({ label: String(n), cls: 'loop sm', action: a(`loop${n}`), onPress: () => d.loop?.beats === n ? d.exitLoop() : d.loopBeats(n) }); this.loopBtns[n] = b; loops.append(b.el); }
    const lin = button({ label: 'IN', cls: 'sm expert-only', action: a('loopIn'), onPress: () => d.loopIn() });
    const lout = button({ label: 'OUT', cls: 'sm expert-only', action: a('loopOut'), onPress: () => d.loopOut() });
    const lhalf = button({ label: '½', cls: 'sm expert-only', action: a('loopHalf'), onPress: () => d.loopHalf() });
    const ldbl = button({ label: '×2', cls: 'sm expert-only', action: a('loopDouble'), onPress: () => d.loopDouble() });
    this.$loopExit = button({ label: 'EXIT', cls: 'sm', action: a('loopExit'), onPress: () => d.exitLoop() });
    const jb = button({ label: '◀4', cls: 'sm expert-only', action: a('jumpBack'), title: 'Saltar 4 beats atrás', onPress: () => d.beatJump(-4) });
    const jf = button({ label: '4▶', cls: 'sm expert-only', action: a('jumpFwd'), title: 'Saltar 4 beats adelante', onPress: () => d.beatJump(4) });
    loops.append(lin.el, lout.el, lhalf.el, ldbl.el, this.$loopExit.el, jb.el, jf.el);
    this.$loopIn = lin;
    // transporte
    this.$cue = button({ label: 'CUE', cls: 'cue big', action: a('cue'), onPress: () => d.cueDown(), onRelease: () => d.cueUp() });
    this.$play = button({ label: '▶', cls: 'play big', action: a('play'), onPress: () => d.togglePlay() });
    this.$sync = button({ label: 'SYNC', cls: 'sync big', action: a('sync'), onPress: () => this.onSync(d) });
    const transport = el('div', { class: 'transport' }, this.$cue.el, this.$play.el, this.$sync.el);
    const controls = el('div', { class: 'controls' }, el('div', { class: 'row-label' }, 'HOT CUES'), hot, el('div', { class: 'row-label' }, 'LOOP'), loops, transport);
    // pitch
    this.pitch = fader({ min: -1, max: 1, def: 0, vertical: true, bipolar: true, detent: true, action: a('pitch'), cls: 'pitch-fader', fmt: (v) => fmtPct(1 + v * d.pitchRange), onChange: (v) => d.setPitch(v) });
    this.$keylock = button({ label: 'KEY', cls: 'sm expert-only kl', action: a('keylock'), title: 'Keylock (mantener tonalidad)', onPress: () => d.setKeylock(!d.keylock) });
    this.$range = el('select', { class: 'range expert-only', title: 'Rango de pitch' }, ...[8, 16, 50].map(v => el('option', { value: v / 100 }, `±${v}`)));
    this.$range.addEventListener('change', () => d.setPitchRange(parseFloat(this.$range.value)));
    this.$quant = button({ label: 'Q', cls: 'sm expert-only', action: a('quantize'), title: 'Quantize (cues y loops al beat)', onPress: () => { d.quantize = !d.quantize; this.refresh(); } });
    this.$grid = button({ label: 'GRID', cls: 'sm expert-only', title: 'Fijar el beat 1 en la posición actual', onPress: () => d.setGridHere() });
    const pitch = el('div', { class: 'pitch' }, el('span', { class: 'row-label' }, 'PITCH'), this.pitch.el, this.$keylock.el, this.$range, this.$quant.el, this.$grid.el);
    const body = el('div', { class: 'deck-body' }, this.$platter, controls, pitch);
    r.append(head, this.$overview, body);
    // drop
    r.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('text/x-track') || e.dataTransfer.types.includes('Files')) { e.preventDefault(); r.classList.add('drop'); } });
    r.addEventListener('dragleave', () => r.classList.remove('drop'));
    r.addEventListener('drop', e => { r.classList.remove('drop'); const id = e.dataTransfer.getData('text/x-track'); if (id) { e.preventDefault(); this.onDropTrack(id, d); } });
    this.refresh();
  }
  _platterDrag() {
    const p = this.$platter, d = this.deck; let lastA = null;
    const ang = (e) => { const r = p.getBoundingClientRect(); return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)); };
    p.addEventListener('pointerdown', e => { if (e.button !== 0 || e.target.closest('iframe')) return; p.setPointerCapture(e.pointerId); lastA = ang(e); p.classList.add('active'); });
    p.addEventListener('pointermove', e => { if (lastA == null || !p.hasPointerCapture(e.pointerId)) return; const a2 = ang(e); let da = a2 - lastA; if (da > Math.PI) da -= 2 * Math.PI; if (da < -Math.PI) da += 2 * Math.PI; lastA = a2; d.nudge(da / (2 * Math.PI)); });
    const up = () => { lastA = null; p.classList.remove('active'); };
    p.addEventListener('pointerup', up); p.addEventListener('pointercancel', up);
  }
  onLoaded() {
    const d = this.deck, t = d.track; this.root.classList.remove('loading');
    this.$title.textContent = t ? t.title : 'Sin pista';
    this.$artist.textContent = t ? (t.artist || '—') : `Deck ${d.id}`;
    this.$art.style.backgroundImage = t?.cover ? `url("${t.cover}")` : '';
    this.root.classList.toggle('has-video', d.kind === 'youtube');
    this.root.classList.toggle('stream', !!t && !d.supports.waveform);
    this.$range.value = String(d.pitchRange);
    this.refresh(); this.refreshRate();
  }
  refresh() {
    const d = this.deck;
    this.$play.set(d.playing); this.$play.el.innerHTML = d.playing ? '❚❚' : '▶';
    this.$bpm.textContent = fmtBpm(d.effectiveBpm);
    this.hotBtns.forEach((b, i) => { b.set(!!d.hotcues[i]); b.el.title = d.hotcues[i] ? `Hot cue ${i + 1} @ ${fmtTime(d.hotcues[i].pos)} (Shift+click borra)` : 'Click: fijar hot cue'; });
    for (const [n, b] of Object.entries(this.loopBtns)) b.set(d.loop?.beats === +n);
    this.$loopExit.set(!!d.loop); this.$loopIn.set(d._loopIn != null);
    this.$keylock.set(d.keylock); this.$quant.set(d.quantize);
    this.root.classList.toggle('playing', d.playing);
    this.$sync.el.disabled = !d.bpm;
  }
  refreshRate() { const d = this.deck; this.pitch.set(d.pitch ?? 0, true); this.$pitchTxt.textContent = fmtPct(d.rate); this.$bpm.textContent = fmtBpm(d.effectiveBpm); }
  update() {
    const d = this.deck, now = performance.now(), dt = (now - this._last) / 1000; this._last = now;
    if (d.loaded) {
      const p = d.position;
      this.$time.textContent = fmtTime(p); this.$remain.textContent = fmtTime(d.duration - p, { neg: true });
      if (d.playing) this.angle = (this.angle + dt * d.rate * 200) % 360;
      this.$disc.style.transform = `rotate(${this.angle}deg)`;
    }
    this.overview.draw();
  }
}

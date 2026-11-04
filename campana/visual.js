/* ==========================================================================
   CAMPANA · visual onírico (canvas 2D)
   Abajo, el SPY es un horizonte de luz sobre un mar; en el cielo, la acción enfocada es una
   aurora que se dibuja con su precio; arriba, las demás acciones son una constelación.
   Cada nota florece en una partícula, cada acorde en un anillo, cada latido respira.
   ========================================================================== */
(function (g) {
  'use strict';
  const C = g.Campana;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  const PALETAS = {
    lidio:     { fondo: [16, 10, 36], nebulosa: ['#ffb86b', '#ff6fd8', '#7a5cff'], acento: '#ffd27a', mar: [60, 40, 120] },
    jonico:    { fondo: [8, 14, 34],  nebulosa: ['#5ec8ff', '#a78bff', '#ffd9a0'], acento: '#bfe3ff', mar: [20, 50, 110] },
    mixolidio: { fondo: [22, 10, 24], nebulosa: ['#ffa36b', '#ff7aa2', '#6b7bff'], acento: '#ffc49a', mar: [90, 40, 70] },
    dorico:    { fondo: [6, 18, 24],  nebulosa: ['#3fd1c8', '#4e7cff', '#b58cff'], acento: '#9fe9e0', mar: [15, 70, 80] },
    eolico:    { fondo: [7, 9, 26],   nebulosa: ['#3a4bd8', '#7b3fa0', '#2a9ab0'], acento: '#8ea0ff', mar: [15, 25, 90] },
    frigio:    { fondo: [22, 5, 12],  nebulosa: ['#c8143c', '#5a1a6b', '#ff6a3d'], acento: '#ff8a7a', mar: [90, 15, 35] },
    locrio:    { fondo: [4, 4, 9],    nebulosa: ['#555577', '#8a0f3a', '#2b2b5a'], acento: '#b0b0c8', mar: [25, 25, 50] },
  };

  function hexRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const rgba = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

  class Visual {
    constructor(canvas, motor) {
      this.cv = canvas; this.ctx = canvas.getContext('2d', { alpha: false }); this.motor = motor;
      this.cola = []; this.particulas = []; this.anillos = []; this.estelas = []; this.chispas = [];
      this.estado = null; this.paleta = PALETAS.jonico; this.fondo = [8, 14, 34]; this.mar = [20, 50, 110];
      this.nebColores = this.paleta.nebulosa.map(hexRgb); this.nebObjetivo = this.nebColores.map((c) => c.slice());
      this.pulso = 0; this.flash = 0; this.sacudida = 0; this.tiempo = 0; this.ultimoFrame = performance.now();
      this.escSpy = null; this.escSol = null; this.solSym = null; this.solAlpha = 0;
      this.sprites = new Map(); this.posEstrellas = {}; this.hover = null;
      this.estrellas = Array.from({ length: 160 }, (_, i) => ({ x: Math.random(), y: Math.random() * .55, r: .4 + Math.random() * 1.3, f: Math.random() * 6.28, v: .3 + Math.random() }));
      this.redimensionar();
      window.addEventListener('resize', () => this.redimensionar());
    }

    redimensionar() {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.6);
      this.W = window.innerWidth; this.H = window.innerHeight;
      this.cv.width = Math.floor(this.W * dpr); this.cv.height = Math.floor(this.H * dpr);
      this.cv.style.width = this.W + 'px'; this.cv.style.height = this.H + 'px';
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.ctx.fillStyle = rgba(this.fondo, 1); this.ctx.fillRect(0, 0, this.W, this.H);
      // viñeta pre-renderizada
      const v = document.createElement('canvas'); v.width = this.W; v.height = this.H;
      const vc = v.getContext('2d');
      const gr = vc.createRadialGradient(this.W / 2, this.H / 2, Math.min(this.W, this.H) * .35, this.W / 2, this.H / 2, Math.max(this.W, this.H) * .75);
      gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,.72)');
      vc.fillStyle = gr; vc.fillRect(0, 0, this.W, this.H);
      this.vineta = v;
    }

    sprite(color) {
      if (this.sprites.has(color)) return this.sprites.get(color);
      const s = document.createElement('canvas'); s.width = s.height = 64;
      const c = s.getContext('2d'); const rgb = hexRgb(color);
      const gr = c.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.18, rgba(rgb, .95)); gr.addColorStop(.5, rgba(rgb, .25)); gr.addColorStop(1, rgba(rgb, 0));
      c.fillStyle = gr; c.fillRect(0, 0, 64, 64);
      this.sprites.set(color, s); return s;
    }

    evento(e) { this.cola.push(e); }
    actualizar(estado) { this.estado = estado; }
    reset() { this.particulas = []; this.anillos = []; this.estelas = []; this.chispas = []; this.cola = []; this.escSpy = null; this.escSol = null; this.solSym = null; this.solAlpha = 0; this.auroraClave = null; }

    /* ----------------------------------------------------------- geometría */
    xDe(m) { const pad = this.W * .05; return pad + (m / 389) * (this.W - 2 * pad); }
    escala(actual, est, dt, pad) {
      if (!est || !est.ultimo) return actual;
      const rango = Math.max(est.max - est.min, est.ultimo[4] * .002);
      const lo = est.min - rango * pad, hi = est.max + rango * pad;
      if (!actual) return { lo, hi };
      const k = 1 - Math.exp(-dt * 2.2);
      return { lo: lerp(actual.lo, lo, k), hi: lerp(actual.hi, hi, k) };
    }
    yDe(p, esc, yTop, yBot) { return yBot - clamp((p - esc.lo) / (esc.hi - esc.lo), -.2, 1.2) * (yBot - yTop); }

    puntoSpy() {
      const E = this.estado; if (!E || !E.spy.est.ultimo || !this.escSpy) return { x: this.W / 2, y: this.H * .68 };
      const b = E.spy.est.ultimo; return { x: this.xDe(b[0]), y: this.yDe(b[4], this.escSpy, this.H * .54, this.H * .75) };
    }
    puntoSolista() {
      const E = this.estado; if (!E || !E.solista || !E.solista.est.ultimo || !this.escSol) return { x: this.W / 2, y: this.H * .33 };
      const b = E.solista.est.ultimo; return { x: this.xDe(b[0]), y: this.yDe(b[4], this.escSol, this.H * .2, this.H * .47) };
    }
    estrellaEn(px, py) {
      let mejor = null, d2 = 24 * 24;
      for (const s in this.posEstrellas) { const p = this.posEstrellas[s]; const d = (p.x - px) ** 2 + (p.y - py) ** 2; if (d < d2) { d2 = d; mejor = s; } }
      return mejor;
    }

    /* ----------------------------------------------------------- eventos */
    procesar(tAudio) {
      const restantes = [];
      for (const e of this.cola) {
        if (e.t > tAudio + .015) { restantes.push(e); continue; }
        if (e.t < tAudio - 2) continue;
        this.disparar(e);
      }
      this.cola = restantes;
    }
    disparar(e) {
      switch (e.tipo) {
        case 'nota': {
          const p = this.puntoSolista();
          const n = 1 + Math.floor(e.vel * 3);
          for (let i = 0; i < n; i++) this.particulas.push({ x: p.x + (Math.random() - .5) * 10, y: p.y + (Math.random() - .5) * 10, vx: (Math.random() - .5) * 26, vy: -(18 + 55 * e.vel) * (0.6 + Math.random() * .6), r: 5 + 12 * e.vel * (0.6 + Math.random() * .6), vida: 0, dur: 2.2 + Math.min(e.dur, 3) * .8 + Math.random(), color: e.color, giro: Math.random() * 6.28 });
          break;
        }
        case 'acorde': {
          const p = this.puntoSpy();
          this.anillos.push({ x: p.x, y: p.y, r: 6, vida: 0, dur: 3.2, color: this.paleta.acento, ancho: 2.2 });
          this.anillos.push({ x: p.x, y: p.y, r: 2, vida: -.25, dur: 3.6, color: '#ffffff', ancho: .8 });
          break;
        }
        case 'pulso': this.pulso = Math.min(1, this.pulso + e.fuerza * .8); break;
        case 'golpe': this.flash = .35; this.sacudida = 9; break;
        case 'maximo': case 'minimo': {
          const p = e.sym === 'SPY' ? this.puntoSpy() : this.puntoSolista();
          const dir = e.tipo === 'maximo' ? -1 : 1;
          this.estelas.push({ x: p.x, y: p.y, vx: 60 + Math.random() * 60, vy: dir * (160 + Math.random() * 80), vida: 0, dur: 1.4, color: e.sym === 'SPY' ? this.paleta.acento : (this.estado && this.estado.solista ? this.estado.solista.color : '#fff') });
          break;
        }
        case 'apertura': case 'cierre': {
          const p = this.puntoSpy();
          for (let i = 0; i < 3; i++) this.anillos.push({ x: p.x, y: p.y, r: 4, vida: -i * .35, dur: 5, color: '#fff2c4', ancho: 3 - i * .7 });
          this.flash = .22;
          break;
        }
        case 'coro': {
          const p = this.posEstrellas[e.sym]; if (!p) break;
          for (let i = 0; i < 8; i++) { const a = Math.random() * 6.28, v = 20 + Math.random() * 50; this.chispas.push({ x: p.x, y: p.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, vida: 0, dur: 1.2 + Math.random() * .6, color: e.color }); }
          break;
        }
      }
    }

    /* ----------------------------------------------------------- cuadro */
    frame() {
      const ahora = performance.now(); const dt = Math.min(.05, (ahora - this.ultimoFrame) / 1000); this.ultimoFrame = ahora; this.tiempo += dt;
      const ctx = this.ctx, W = this.W, H = this.H, E = this.estado;
      const tAudio = this.motor.ahora(); const nivel = this.motor.nivel();
      this.procesar(tAudio);
      this.pulso *= Math.exp(-dt * 4.5); this.flash *= Math.exp(-dt * 6); this.sacudida *= Math.exp(-dt * 8);

      // paleta según el modo
      const pal = PALETAS[(E && E.modo) || 'jonico'] || PALETAS.jonico; this.paleta = pal;
      const k = 1 - Math.exp(-dt * 1.2);
      for (let i = 0; i < 3; i++) { this.fondo[i] = lerp(this.fondo[i], pal.fondo[i], k); this.mar[i] = lerp(this.mar[i], pal.mar[i], k); }
      pal.nebulosa.forEach((hex, i) => { const o = hexRgb(hex); for (let j = 0; j < 3; j++) this.nebColores[i][j] = lerp(this.nebColores[i][j], o[j], k); });

      ctx.save();
      if (this.sacudida > .3) ctx.translate((Math.random() - .5) * this.sacudida, (Math.random() - .5) * this.sacudida);
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = rgba(this.fondo, .26); ctx.fillRect(-10, -10, W + 20, H + 20);

      this.dibujarNebulosa(ctx, nivel);
      this.dibujarEstrellasFijas(ctx);
      if (E) {
        this.escSpy = this.escala(this.escSpy, E.spy.est, dt, .18);
        if (E.solista) {
          if (E.solista.sym !== this.solSym) { this.solSym = E.solista.sym; this.escSol = null; this.solAlpha = 0; }
          this.escSol = this.escala(this.escSol, E.solista.est, dt, .22);
          this.solAlpha = Math.min(1, this.solAlpha + dt * .8);
        }
        this.dibujarMar(ctx, nivel);
        this.dibujarHorizonte(ctx, nivel);
        if (E.solista && this.escSol) this.dibujarAurora(ctx, nivel);
        this.dibujarConstelacion(ctx);
      }
      this.dibujarParticulas(ctx, dt);
      ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(this.vineta, 0, 0);
      if (this.flash > .01) { ctx.fillStyle = `rgba(255,255,255,${this.flash})`; ctx.fillRect(0, 0, W, H); }
      ctx.restore();
    }

    dibujarNebulosa(ctx, nivel) {
      const W = this.W, H = this.H, t = this.tiempo;
      ctx.globalCompositeOperation = 'lighter';
      const R = Math.min(W, H) * (0.42 + .06 * this.pulso + .08 * nivel.graves);
      const centros = [
        [W * (.5 + .18 * Math.sin(t * .07)), H * (.42 + .08 * Math.cos(t * .05))],
        [W * (.25 + .1 * Math.cos(t * .043 + 1)), H * (.3 + .1 * Math.sin(t * .061))],
        [W * (.75 + .1 * Math.sin(t * .051 + 2)), H * (.36 + .09 * Math.cos(t * .047 + 1))],
      ];
      centros.forEach(([x, y], i) => {
        const c = this.nebColores[i];
        const gr = ctx.createRadialGradient(x, y, 0, x, y, R * (i === 0 ? 1.15 : .85));
        gr.addColorStop(0, rgba(c, .17 + .1 * nivel.total)); gr.addColorStop(.45, rgba(c, .055)); gr.addColorStop(1, rgba(c, 0));
        ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);
      });
    }

    dibujarEstrellasFijas(ctx) {
      ctx.globalCompositeOperation = 'lighter';
      const t = this.tiempo;
      for (const s of this.estrellas) {
        const a = .25 + .45 * (0.5 + 0.5 * Math.sin(t * s.v + s.f));
        ctx.fillStyle = `rgba(255,255,255,${a * .55})`;
        ctx.beginPath(); ctx.arc(s.x * this.W, s.y * this.H, s.r, 0, 6.283); ctx.fill();
      }
    }

    dibujarMar(ctx, nivel) {
      const W = this.W, H = this.H, p = this.puntoSpy();
      ctx.globalCompositeOperation = 'source-over';
      const gr = ctx.createLinearGradient(0, H * .62, 0, H);
      gr.addColorStop(0, rgba(this.mar, 0)); gr.addColorStop(.35, rgba(this.mar, .22)); gr.addColorStop(1, rgba(this.mar, .5));
      ctx.fillStyle = gr; ctx.fillRect(0, H * .62, W, H * .38);
      // destellos del mar que respiran con los graves
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 5; i++) {
        const y = p.y + 30 + i * 22 + Math.sin(this.tiempo * .6 + i) * 4;
        const w = (W * .18 + i * 40) * (1 + .4 * nivel.graves);
        const g2 = ctx.createLinearGradient(p.x - w, y, p.x + w, y);
        const c = hexRgb(this.paleta.acento);
        g2.addColorStop(0, rgba(c, 0)); g2.addColorStop(.5, rgba(c, .05 + .05 * this.pulso)); g2.addColorStop(1, rgba(c, 0));
        ctx.fillStyle = g2; ctx.fillRect(p.x - w, y, w * 2, 1.2);
      }
    }

    trazoLuz(ctx, puntos, color, grosor, alfa) {
      if (puntos.length < 2) return;
      const c = hexRgb(color);
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      const capas = [[grosor * 7, alfa * .06], [grosor * 3.2, alfa * .16], [grosor * 1.4, alfa * .45], [grosor * .6, alfa * 1]];
      for (const [w, a] of capas) {
        ctx.beginPath(); ctx.moveTo(puntos[0].x, puntos[0].y);
        for (let i = 1; i < puntos.length; i++) ctx.lineTo(puntos[i].x, puntos[i].y);
        ctx.strokeStyle = w === grosor * .6 ? `rgba(255,255,255,${a * .85})` : rgba(c, a); ctx.lineWidth = w; ctx.stroke();
      }
    }

    dibujarHorizonte(ctx, nivel) {
      const E = this.estado, est = E.spy.est; if (!est.ultimo) return;
      const H = this.H, yTop = H * .54, yBot = H * .75;
      const pts = est.velas.map((b) => ({ x: this.xDe(b[0]), y: this.yDe(b[4], this.escSpy, yTop, yBot) }));
      ctx.globalCompositeOperation = 'lighter';
      // bruma bajo la línea
      const p = pts[pts.length - 1];
      ctx.beginPath(); ctx.moveTo(pts[0].x, H);
      for (const q of pts) ctx.lineTo(q.x, q.y);
      ctx.lineTo(p.x, H); ctx.closePath();
      const gr = ctx.createLinearGradient(0, yTop, 0, H);
      const c = hexRgb(this.paleta.acento);
      gr.addColorStop(0, rgba(c, .12)); gr.addColorStop(.5, rgba(c, .04)); gr.addColorStop(1, rgba(c, 0));
      ctx.fillStyle = gr; ctx.fill();
      this.trazoLuz(ctx, pts, this.paleta.acento, 3, .9);
      // orbe del presente
      const s = this.sprite(this.paleta.acento); const r = 22 + 26 * this.pulso + 20 * nivel.graves;
      ctx.globalAlpha = .9; ctx.drawImage(s, p.x - r, p.y - r, r * 2, r * 2); ctx.globalAlpha = 1;
    }

    dibujarAurora(ctx, nivel) {
      const E = this.estado, S = E.solista, est = S.est; if (!est.ultimo) return;
      const H = this.H, yTop = H * .2, yBot = H * .47, alfa = this.solAlpha;
      const pts = est.velas.map((b) => ({ x: this.xDe(b[0]), y: this.yDe(b[4], this.escSol, yTop, yBot), v: b[5] }));
      const c = hexRgb(S.color);
      // la cortina de la aurora se dibuja en una capa aparte y sólo se rehace cuando cambia algo
      const clave = `${S.sym}|${pts.length}|${this.escSol.lo.toFixed(3)}|${this.escSol.hi.toFixed(3)}|${this.W}x${this.H}`;
      if (this.auroraClave !== clave) {
        this.auroraClave = clave;
        const dpr = Math.min(window.devicePixelRatio || 1, 1.6);
        if (!this.auroraCapa || this.auroraCapa.width !== Math.floor(this.W * dpr)) { this.auroraCapa = document.createElement('canvas'); this.auroraCapa.width = Math.floor(this.W * dpr); this.auroraCapa.height = Math.floor(this.H * dpr); }
        const cc = this.auroraCapa.getContext('2d');
        cc.setTransform(dpr, 0, 0, dpr, 0, 0); cc.clearRect(0, 0, this.W, this.H);
        const alto = H * .17;
        const maxV = Math.max(...est.vols.slice(-60), 1);
        for (let i = 1; i < pts.length; i++) {
          const a = pts[i - 1], b = pts[i];
          const brillo = clamp(b.v / maxV, .08, 1);
          const gr = cc.createLinearGradient(0, b.y, 0, b.y + alto);
          gr.addColorStop(0, rgba(c, .14 + .26 * brillo)); gr.addColorStop(.45, rgba(c, .05 + .04 * brillo)); gr.addColorStop(1, rgba(c, 0));
          cc.fillStyle = gr;
          cc.beginPath(); cc.moveTo(a.x, a.y); cc.lineTo(b.x, b.y); cc.lineTo(b.x, b.y + alto); cc.lineTo(a.x, a.y + alto); cc.closePath(); cc.fill();
        }
        this.trazoLuz(cc, pts, S.color, 1.8, .9);
      }
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = alfa * (.82 + .18 * Math.sin(this.tiempo * .9));
      ctx.drawImage(this.auroraCapa, 0, 0, this.W, this.H);
      // velos que recorren la cortina
      ctx.globalAlpha = alfa;
      const p = pts[pts.length - 1];
      for (let i = 0; i < 6; i++) {
        const f = ((this.tiempo * .05 * (1 + i * .13) + i / 6) % 1);
        const x = pts[0].x + (p.x - pts[0].x) * f; if (x > p.x) continue;
        const idx = Math.min(pts.length - 1, Math.floor(f * (pts.length - 1))); const y = pts[idx].y;
        const gr = ctx.createLinearGradient(0, y - 10, 0, y + H * .2);
        gr.addColorStop(0, rgba(c, 0)); gr.addColorStop(.3, rgba(c, .12 + .08 * nivel.agudos)); gr.addColorStop(1, rgba(c, 0));
        ctx.fillStyle = gr; ctx.fillRect(x - 6, y - 10, 12, H * .2 + 10);
      }
      const s = this.sprite(S.color); const r = 16 + 18 * nivel.medios + 8 * this.pulso;
      ctx.drawImage(s, p.x - r, p.y - r, r * 2, r * 2);
      ctx.globalAlpha = 1;
    }

    dibujarConstelacion(ctx) {
      const E = this.estado, otros = E.otros || []; if (!otros.length) return;
      const W = this.W, H = this.H, n = otros.length;
      ctx.globalCompositeOperation = 'lighter';
      ctx.font = '500 11px Inter, system-ui, sans-serif'; ctx.textAlign = 'center';
      otros.forEach((o, i) => {
        const est = o.est; const x = W * (.07 + .86 * (n === 1 ? .5 : i / (n - 1))) + Math.sin(this.tiempo * .3 + i) * 6;
        const pct = est.ultimo ? est.pct : 0;
        const y = H * .155 - clamp(pct * 240, -34, 34) + Math.cos(this.tiempo * .25 + i * 1.7) * 3;
        this.posEstrellas[o.sym] = { x, y };
        const rel = est.ultimo ? clamp(est.relVol, .3, 4) : .5;
        const r = (5 + 4 * rel) * (o.enfocado ? 1.6 : 1) * (this.hover === o.sym ? 1.3 : 1);
        const s = this.sprite(o.color);
        ctx.globalAlpha = o.enfocado ? 1 : .7;
        ctx.drawImage(s, x - r * 2, y - r * 2, r * 4, r * 4);
        if (o.enfocado) { ctx.strokeStyle = rgba(hexRgb(o.color), .6); ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x, y, r * 1.6 + 2 * this.pulso, 0, 6.283); ctx.stroke(); }
        ctx.globalAlpha = o.enfocado || this.hover === o.sym ? .95 : .55;
        ctx.fillStyle = '#ffffff';
        ctx.fillText(o.sym, x, y + r * 1.8 + 12);
        if (est.ultimo) { ctx.fillStyle = pct >= 0 ? 'rgba(170,255,200,.9)' : 'rgba(255,170,170,.9)'; ctx.font = '500 10px Inter, system-ui, sans-serif'; ctx.fillText(`${pct >= 0 ? '+' : ''}${(pct * 100).toFixed(1)} %`, x, y + r * 1.8 + 24); ctx.font = '500 11px Inter, system-ui, sans-serif'; }
        ctx.globalAlpha = 1;
      });
    }

    dibujarParticulas(ctx, dt) {
      ctx.globalCompositeOperation = 'lighter';
      // partículas de notas
      const vivas = [];
      for (const p of this.particulas) {
        p.vida += dt; if (p.vida > p.dur) continue;
        const f = p.vida / p.dur; p.x += (p.vx + Math.sin(this.tiempo * 2 + p.giro) * 12) * dt; p.y += p.vy * dt; p.vy *= (1 - dt * .6);
        const a = f < .1 ? f / .1 : 1 - (f - .1) / .9; const r = p.r * (1 + f * 1.6);
        ctx.globalAlpha = a * .85; ctx.drawImage(this.sprite(p.color), p.x - r, p.y - r, r * 2, r * 2);
        vivas.push(p);
      }
      this.particulas = vivas.length > 420 ? vivas.slice(-420) : vivas;
      // anillos de acordes
      const an = [];
      for (const a of this.anillos) {
        a.vida += dt; if (a.vida > a.dur) continue; if (a.vida < 0) { an.push(a); continue; }
        const f = a.vida / a.dur; const r = a.r + f * f * Math.min(this.W, this.H) * .55;
        ctx.globalAlpha = (1 - f) * .55; ctx.strokeStyle = a.color; ctx.lineWidth = a.ancho * (1 - f * .6);
        ctx.beginPath(); ctx.ellipse(a.x, a.y, r, r * .38, 0, 0, 6.283); ctx.stroke();
        an.push(a);
      }
      this.anillos = an;
      // estelas (máximos y mínimos)
      const es = [];
      for (const e of this.estelas) {
        e.vida += dt; if (e.vida > e.dur) continue;
        const f = e.vida / e.dur; const x = e.x + e.vx * e.vida, y = e.y + e.vy * e.vida;
        ctx.globalAlpha = (1 - f) * .9; ctx.strokeStyle = e.color; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x - e.vx * .25, y - e.vy * .25); ctx.lineTo(x, y); ctx.stroke();
        const s = this.sprite(e.color); ctx.drawImage(s, x - 10, y - 10, 20, 20);
        es.push(e);
      }
      this.estelas = es;
      // chispas del coro
      const ch = [];
      for (const c of this.chispas) {
        c.vida += dt; if (c.vida > c.dur) continue;
        c.x += c.vx * dt; c.y += c.vy * dt; c.vy += 10 * dt;
        ctx.globalAlpha = (1 - c.vida / c.dur) * .9; ctx.drawImage(this.sprite(c.color), c.x - 4, c.y - 4, 8, 8);
        ch.push(c);
      }
      this.chispas = ch;
      ctx.globalAlpha = 1;
    }
  }

  g.Campana.Visual = Visual;
  g.Campana.PALETAS = PALETAS;
})(window);

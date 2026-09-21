// recorder.js — grabación de audio (y opcionalmente cámara) con MediaRecorder.
// La base de YouTube suena por los parlantes y el micrófono la capta junto con
// el instrumento; con auriculares se graba solo el instrumento. El archivo
// local sí se puede mezclar en la grabación (ver mixLocal).
(function () {
  'use strict';

  class Recorder {
    constructor() { this.stream = null; this.rec = null; this.chunks = []; this.startedAt = 0; this.previewEl = null; }

    async start({ video = false, deviceId = null, previewEl = null } = {}) {
      const constraints = {
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, ...(deviceId ? { deviceId: { exact: deviceId } } : {}) },
        video: video ? { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' } : false,
      };
      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
      if (video && previewEl) { previewEl.srcObject = this.stream; previewEl.muted = true; previewEl.play().catch(() => { }); this.previewEl = previewEl; }
      const mime = pickMime(video);
      this.rec = new MediaRecorder(this.stream, mime ? { mimeType: mime } : undefined);
      this.chunks = [];
      this.rec.ondataavailable = (e) => { if (e.data && e.data.size) this.chunks.push(e.data); };
      this.rec.start(250);
      this.startedAt = performance.now();
      this.video = video;
      return { mime: this.rec.mimeType };
    }

    async stop() {
      if (!this.rec) return null;
      const rec = this.rec;
      const blob = await new Promise((resolve) => {
        rec.onstop = () => resolve(new Blob(this.chunks, { type: rec.mimeType }));
        rec.state !== 'inactive' ? rec.stop() : rec.onstop();
      });
      this.stream.getTracks().forEach(t => t.stop());
      if (this.previewEl) { this.previewEl.srcObject = null; this.previewEl = null; }
      const durationMs = performance.now() - this.startedAt;
      this.rec = null; this.stream = null;
      return { blob, duration: durationMs / 1000, video: this.video, mime: blob.type };
    }

    get recording() { return !!this.rec && this.rec.state === 'recording'; }

    static async listMics() {
      try {
        const devs = await navigator.mediaDevices.enumerateDevices();
        return devs.filter(d => d.kind === 'audioinput');
      } catch (e) { return []; }
    }
  }

  function pickMime(video) {
    const cands = video
      ? ['video/mp4;codecs=avc1,mp4a.40.2', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4']
      : ['audio/webm;codecs=opus', 'audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus'];
    for (const c of cands) if (window.MediaRecorder && MediaRecorder.isTypeSupported(c)) return c;
    return '';
  }

  window.Recorder = Recorder;
})();

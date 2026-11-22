/**
 * audio.js — all sound. Ambience is synthesised with WebAudio (no files needed);
 * a few one-shots (roar, screech, footsteps) are loaded from assets/audio/.
 * Everything is wrapped so missing/blocked audio never breaks the game.
 */
const rand = (a, b) => a + Math.random() * (b - a);

export class AudioEngine {
  constructor(base = 'assets/audio/') {
    this.base = base;
    this.ctx = null;
    this.buf = {};
    this.fear = 0;
    this.alive = false;
    this.stepSrc = null;
  }

  async start() {
    try {
      if (this.ctx) { await this.ctx.resume(); return; }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = this.ctx = new AC();
      await ctx.resume().catch(() => {});
      this.master = ctx.createGain();
      this.master.gain.value = 0.9;
      this.master.connect(ctx.destination);
      this.noise = this.makeNoise(3);

      this.buildDrone();
      this.buildHum();
      this.buildEntityBed();
      this.buildTinnitus();
      this.alive = true;
      this.eventLoop();
      this.heartLoop();
      this.load();
    } catch (e) { console.warn('audio disabled:', e); }
  }

  stop() { this.alive = false; if (this.ctx) this.ctx.suspend().catch(() => {}); }
  resume() { if (this.ctx) this.ctx.resume().catch(() => {}); this.alive = !!this.ctx; }

  makeNoise(sec) {
    const n = Math.floor(this.ctx.sampleRate * sec);
    const b = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < n; i++) { last = (last + (Math.random() * 2 - 1) * 0.12) * 0.985; d[i] = (Math.random() * 2 - 1) * 0.6 + last * 3; }
    return b;
  }
  noiseSrc() { const s = this.ctx.createBufferSource(); s.buffer = this.noise; s.loop = true; return s; }

  async load() {
    const files = { roar: 'roar.mp3', screech1: 'screech1.mp3', screech2: 'screech2.mp3', steps: 'steps.mp3', fall: 'fall.mp3' };
    await Promise.all(Object.entries(files).map(async ([k, f]) => {
      try {
        const r = await fetch(this.base + f);
        this.buf[k] = await this.ctx.decodeAudioData(await r.arrayBuffer());
      } catch (e) { console.warn('could not load', f, e); }
    }));
  }

  // ---- constant beds ----------------------------------------------------------
  buildDrone() {
    const c = this.ctx;
    const g = c.createGain(); g.gain.value = 0.11;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 170;
    const o1 = c.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 43;
    const o2 = c.createOscillator(); o2.type = 'triangle'; o2.frequency.value = 64.7;
    const lfo = c.createOscillator(); lfo.frequency.value = 0.06;
    const lg = c.createGain(); lg.gain.value = 1.8;
    lfo.connect(lg); lg.connect(o2.frequency);
    o1.connect(lp); o2.connect(lp); lp.connect(g); g.connect(this.master);
    o1.start(); o2.start(); lfo.start();
  }

  buildHum() {
    const c = this.ctx;
    this.humGain = c.createGain(); this.humGain.gain.value = 0.018;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 300; bp.Q.value = 1;
    const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 100;
    o.connect(bp); bp.connect(this.humGain); this.humGain.connect(this.master);
    o.start();
  }

  buildEntityBed() {
    const c = this.ctx;
    this.bedGain = c.createGain(); this.bedGain.gain.value = 0;
    const breath = c.createGain(); breath.gain.value = 0.5;
    const lfo = c.createOscillator(); lfo.frequency.value = 0.23;
    const lg = c.createGain(); lg.gain.value = 0.5;
    lfo.connect(lg); lg.connect(breath.gain);
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 240; bp.Q.value = 2.5;
    const src = this.noiseSrc();
    this.panner = c.createPanner();
    this.panner.panningModel = 'HRTF';
    this.panner.distanceModel = 'inverse';
    this.panner.refDistance = 3; this.panner.rolloffFactor = 0.8;
    src.connect(bp); bp.connect(breath); breath.connect(this.bedGain); this.bedGain.connect(this.panner); this.panner.connect(this.master);
    src.start(); lfo.start();
  }

  buildTinnitus() {
    const c = this.ctx;
    this.tinGain = c.createGain(); this.tinGain.gain.value = 0;
    const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = 6100;
    o.connect(this.tinGain); this.tinGain.connect(this.master);
    o.start();
  }

  // ---- per-frame --------------------------------------------------------------
  /**
   * @param {{fear:number, entity:{x:number,y:number,z:number}|null, cam:{x:number,y:number,z:number}, fwd:{x:number,y:number,z:number}, speed:number, sprinting:boolean}} s
   */
  update(s) {
    if (!this.alive || !this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    this.fear = s.fear;
    this.bedGain.gain.setTargetAtTime(Math.pow(s.fear, 1.4) * 1.1, t, 0.25);
    this.tinGain.gain.setTargetAtTime(Math.max(0, s.fear - 0.55) * 0.035, t, 0.3);
    this.humGain.gain.setTargetAtTime(0.018 + s.fear * 0.02, t, 0.3);

    const L = c.listener;
    if (L.positionX) {
      L.positionX.value = s.cam.x; L.positionY.value = s.cam.y; L.positionZ.value = s.cam.z;
      L.forwardX.value = s.fwd.x; L.forwardY.value = s.fwd.y; L.forwardZ.value = s.fwd.z;
      L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0;
    } else {
      L.setPosition(s.cam.x, s.cam.y, s.cam.z);
      L.setOrientation(s.fwd.x, s.fwd.y, s.fwd.z, 0, 1, 0);
    }
    if (s.entity) {
      const P = this.panner;
      if (P.positionX) { P.positionX.value = s.entity.x; P.positionY.value = s.entity.y; P.positionZ.value = s.entity.z; }
      else P.setPosition(s.entity.x, s.entity.y, s.entity.z);
    }

    // footsteps
    if (this.buf.steps && !this.stepSrc) {
      this.stepGain = c.createGain(); this.stepGain.gain.value = 0;
      this.stepSrc = c.createBufferSource();
      this.stepSrc.buffer = this.buf.steps; this.stepSrc.loop = true;
      this.stepSrc.connect(this.stepGain); this.stepGain.connect(this.master);
      this.stepSrc.start();
    }
    if (this.stepSrc) {
      this.stepGain.gain.setTargetAtTime(s.speed > 0.6 ? (s.sprinting ? 0.55 : 0.32) : 0, t, 0.06);
      this.stepSrc.playbackRate.setTargetAtTime(s.sprinting ? 1.5 : 1.0, t, 0.1);
    }
  }

  // ---- one-shots --------------------------------------------------------------
  play(name, gain = 0.9, rate = 1) {
    if (!this.ctx || !this.buf[name]) return;
    const s = this.ctx.createBufferSource(); s.buffer = this.buf[name]; s.playbackRate.value = rate;
    const g = this.ctx.createGain(); g.gain.value = gain;
    s.connect(g); g.connect(this.master); s.start();
  }
  sting() { this.play('roar', 1.0, 0.85); }
  scream() { this.play(Math.random() < 0.5 ? 'screech1' : 'screech2', 1.0, 0.9); this.play('fall', 0.8); this.thud(40, 0.9, 0); }

  thud(freq, gain, delay) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime + delay;
    const o = c.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(freq, t); o.frequency.exponentialRampToValueAtTime(freq * 0.55, t + 0.18);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.3);
  }

  burst(dur, freq, q, gain, type = 'bandpass') {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const s = c.createBufferSource(); s.buffer = this.noise;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.master); s.start(t, Math.random() * 2, dur + 0.05);
  }

  click() { this.burst(0.04, 2800, 3, 0.25); }
  crackle() { this.burst(0.07, 3500, 1, 0.1, 'highpass'); }
  thunk() { this.thud(70, 0.5, 0); this.burst(0.08, 900, 2, 0.2); }

  heartLoop() {
    const tick = () => {
      if (!this.ctx) return;
      if (this.alive && this.fear > 0.18) {
        const f = this.fear;
        this.thud(58, 0.25 + f * 0.55, 0);
        this.thud(48, 0.18 + f * 0.4, 0.17);
        setTimeout(tick, (1.1 - 0.7 * f) * 1000);
      } else setTimeout(tick, 300);
    };
    tick();
  }

  // ---- random unease ----------------------------------------------------------
  eventLoop() {
    const next = () => {
      if (!this.ctx) return;
      setTimeout(() => {
        if (this.alive) {
          const r = Math.random();
          if (r < 0.4) this.farThump();
          else if (r < 0.75) this.creak();
          else this.scrape();
        }
        next();
      }, rand(8, 22) * 1000);
    };
    next();
  }

  panned(node, pan = rand(-1, 1)) {
    const p = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
    if (!p) return node;
    p.pan.value = pan; node.connect(p); return p;
  }

  farThump() {
    const c = this.ctx, g = c.createGain(); g.gain.value = rand(0.12, 0.3);
    const out = this.panned(g); out.connect(this.master);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 220; lp.connect(g);
    const t = c.currentTime;
    const o = c.createOscillator(); o.frequency.setValueAtTime(75, t); o.frequency.exponentialRampToValueAtTime(30, t + 0.4);
    const e = c.createGain(); e.gain.setValueAtTime(0.0001, t); e.gain.exponentialRampToValueAtTime(1, t + 0.01); e.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    o.connect(e); e.connect(lp); o.start(t); o.stop(t + 0.65);
  }

  creak() {
    const c = this.ctx, t = c.currentTime, dur = rand(0.9, 1.8);
    const o = c.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(rand(110, 170), t); o.frequency.linearRampToValueAtTime(rand(70, 120), t + dur);
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 600; bp.Q.value = 8;
    bp.frequency.linearRampToValueAtTime(rand(300, 900), t + dur);
    const trem = c.createOscillator(); trem.frequency.value = rand(9, 22);
    const tg = c.createGain(); tg.gain.value = 0.5;
    const g = c.createGain(); g.gain.value = 0;
    trem.connect(tg); tg.connect(g.gain);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.07, t + 0.2); g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(bp); bp.connect(g); this.panned(g).connect(this.master);
    o.start(t); trem.start(t); o.stop(t + dur + 0.05); trem.stop(t + dur + 0.05);
  }

  scrape() {
    const c = this.ctx, t = c.currentTime, dur = rand(1.2, 2.4);
    const s = c.createBufferSource(); s.buffer = this.noise;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 4;
    bp.frequency.setValueAtTime(rand(200, 500), t); bp.frequency.linearRampToValueAtTime(rand(500, 1400), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(rand(0.08, 0.16), t + dur * 0.4); g.gain.linearRampToValueAtTime(0, t + dur);
    s.connect(bp); bp.connect(g); this.panned(g).connect(this.master);
    s.start(t, Math.random() * 2, dur + 0.05);
  }
}

// Ton: gesprochene Zeilen (mp3) in einer Warteschlange, dazu Musik, Meeresrauschen und
// Effekte direkt aus der Web Audio API (keine weiteren Dateien noetig).

const VOICE_PATH = 'assets/audio/voice/';
const PENTA = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25, 783.99];

export class Sound {
  constructor() {
    this.ctx = null;
    this.clips = new Map();
    this.queue = [];
    this.current = null;
    this.muted = false;
    this.lastVoiceEnd = 0;
  }

  get speaking() { return this.current !== null || this.queue.length > 0; }

  // Muss aus einem Tastendruck/Klick heraus aufgerufen werden (Browser-Regel).
  unlock() {
    if (this.ctx) { this.ctx.resume(); return; }
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
    this.musicGain = ctx.createGain();
    this.musicGain.gain.value = 0.5;
    this.musicGain.connect(this.master);
    this.sfxGain = ctx.createGain();
    this.sfxGain.gain.value = 0.55;
    this.sfxGain.connect(this.master);

    // Echo, damit die Toene nach "unter Wasser" klingen
    const delay = ctx.createDelay(1.5);
    delay.delayTime.value = 0.42;
    const fb = ctx.createGain();
    fb.gain.value = 0.38;
    const damp = ctx.createBiquadFilter();
    damp.type = 'lowpass';
    damp.frequency.value = 1800;
    delay.connect(damp).connect(fb).connect(delay);
    damp.connect(this.musicGain);
    this.echo = delay;

    this.#startAmbience();
    this.#scheduleMusic();
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 1;
    if (this.current) this.current.el.muted = m;
  }

  preload(ids) { for (const id of ids) this.#clip(id); }

  #clip(id) {
    let el = this.clips.get(id);
    if (!el) {
      el = new Audio(`${VOICE_PATH}${id}.mp3`);
      el.preload = 'auto';
      this.clips.set(id, el);
    }
    return el;
  }

  // Spricht eine oder mehrere Zeilen nacheinander. Aufloesung, wenn fertig (oder verdraengt).
  say(ids, { interrupt = false } = {}) {
    if (!Array.isArray(ids)) ids = [ids];
    if (interrupt) this.stopVoice();
    return new Promise((resolve) => {
      ids.forEach((id, i) => this.queue.push({ id, done: i === ids.length - 1 ? resolve : null }));
      this.#next();
    });
  }

  stopVoice() {
    for (const q of this.queue) q.done?.(false);
    this.queue = [];
    if (this.current) {
      const c = this.current;
      this.current = null;
      c.el.pause();
      c.done?.(false);
    }
    this.#duck(false);
  }

  #next() {
    if (this.current || !this.queue.length) return;
    const item = this.queue.shift();
    const el = this.#clip(item.id);
    this.current = { ...item, el };
    const finish = (ok) => {
      if (this.current?.el !== el) return;
      this.current = null;
      this.lastVoiceEnd = performance.now();
      item.done?.(ok);
      if (this.queue.length) setTimeout(() => this.#next(), 220);
      else this.#duck(false);
    };
    el.onended = () => finish(true);
    el.onerror = () => finish(false);
    el.currentTime = 0;
    el.muted = this.muted;
    this.#duck(true);
    el.play().catch(() => finish(false));
  }

  #duck(on) {
    if (!this.ctx) return;
    this.musicGain.gain.setTargetAtTime(on ? 0.16 : 0.5, this.ctx.currentTime, 0.25);
  }

  // ---- Effekte ----------------------------------------------------------

  #tone(freq, t, dur, { type = 'sine', gain = 0.3, to = null, dest = this.sfxGain } = {}) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
    return g;
  }

  pop() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.#tone(520, t, 0.16, { to: 1400, gain: 0.35 });
    this.#tone(180, t, 0.1, { to: 60, gain: 0.25, type: 'triangle' });
  }

  chime() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => {
      this.#tone(f, t + i * 0.09, 0.9, { gain: 0.22 });
      this.#tone(f * 2.01, t + i * 0.09, 0.5, { gain: 0.05 });
    });
  }

  slurp() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.#tone(240, t, 0.18, { to: 880, gain: 0.3, type: 'triangle' });
    this.#tone(900, t + 0.16, 0.08, { to: 1500, gain: 0.15 });
  }

  wrong() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.#tone(392, t, 0.22, { gain: 0.2, type: 'triangle' });
    this.#tone(311, t + 0.16, 0.3, { gain: 0.2, type: 'triangle' });
  }

  sparkle() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (let i = 0; i < 6; i++) this.#tone(1200 + Math.random() * 1800, t + i * 0.05, 0.25, { gain: 0.07 });
  }

  // Zusammenstoss: dumpfer Schlag mit Rattern
  bump() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.#tone(150, t, 0.3, { to: 45, gain: 0.5 });
    for (let i = 0; i < 9; i++) this.#tone(i % 2 ? 210 : 260, t + i * 0.042, 0.04, { gain: 0.16, type: 'square' });
  }

  // Wegspicken: aufsteigendes Zischen und ein Schwall Blubbern
  whoosh() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.#tone(260, t, 0.45, { to: 1500, gain: 0.22, type: 'triangle' });
    for (let i = 0; i < 16; i++) {
      const f = 350 + Math.random() * 900;
      this.#tone(f, t + 0.05 + i * 0.045 + Math.random() * 0.03, 0.08, { to: f * 2, gain: 0.09 });
    }
  }

  fanfare() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    [523.25, 523.25, 659.25, 783.99, 659.25, 783.99, 1046.5].forEach((f, i) => {
      this.#tone(f, t + i * 0.16, 0.7, { gain: 0.22, type: 'triangle' });
      this.#tone(f / 2, t + i * 0.16, 0.7, { gain: 0.1 });
    });
  }

  // ---- Musik und Meeresrauschen ------------------------------------------

  #startAmbience() {
    const ctx = this.ctx;
    const len = ctx.sampleRate * 4;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {          // braunes Rauschen
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      d[i] = last * 3.5;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 320;
    const g = ctx.createGain();
    g.gain.value = 0.5;
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 0.11;
    lfoGain.gain.value = 0.18;
    lfo.connect(lfoGain).connect(g.gain);
    src.connect(lp).connect(g).connect(this.musicGain);
    src.start();
    lfo.start();

    const blub = () => {
      const t = ctx.currentTime;
      const n = 1 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) {
        const f = 280 + Math.random() * 500;
        this.#tone(f, t + i * 0.09, 0.09, { to: f * 2.2, gain: 0.05, dest: this.musicGain });
      }
      setTimeout(blub, 2500 + Math.random() * 6000);
    };
    setTimeout(blub, 2000);
  }

  #scheduleMusic() {
    const ctx = this.ctx;
    let padIndex = 0;
    const chords = [[130.81, 196.0, 329.63], [110.0, 164.81, 261.63], [87.31, 174.61, 261.63], [98.0, 196.0, 293.66]];
    const pad = () => {
      const t = ctx.currentTime;
      for (const f of chords[padIndex++ % chords.length]) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'sine';
        o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.06, t + 3);
        g.gain.linearRampToValueAtTime(0.0001, t + 9);
        o.connect(g).connect(this.musicGain);
        o.start(t);
        o.stop(t + 9.2);
      }
      setTimeout(pad, 7000);
    };
    let note = 4;
    const melody = () => {
      const t = ctx.currentTime;
      note = Math.min(PENTA.length - 1, Math.max(0, note + Math.round((Math.random() - 0.5) * 4)));
      const g = this.#tone(PENTA[note], t, 1.6, { gain: 0.11, dest: this.musicGain });
      g.connect(this.echo);
      setTimeout(melody, [500, 750, 1000, 1500, 2250][Math.floor(Math.random() * 5)]);
    };
    pad();
    setTimeout(melody, 1500);
  }
}

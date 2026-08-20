// Everything is synthesised on the fly — no audio files to ship. That includes
// the music: a generative ambient layer scheduled a bar at a time, whose root
// note sinks as the player descends and whose texture thickens in combat.

const SCALES = {
  // Semitone offsets from the root. Calm scenes use natural minor; combat digs
  // into phrygian territory for the flat second's unease.
  calm: [0, 3, 5, 7, 10, 12, 15],
  tense: [0, 1, 5, 6, 8, 12, 13],
};

export class Audio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.musicOn = true;
    this.scene = 'calm';       // calm | explore | combat | boss
    this.depth = 1;
    this.listener = null;      // {x, y, angle} — set every frame while playing
    this._out = null;          // per-play spatial routing, see play()
    this.nextBar = 0;
    this.bar = 0;
  }

  ensure() {
    if (!this.ctx) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return null;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.32;
      this.master.connect(this.ctx.destination);
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = this.musicOn ? 1 : 0;
      this.musicGain.connect(this.master);
      this.nextBar = this.ctx.currentTime + 0.1;
      // Lookahead scheduler: cheap to poll, immune to rAF stalls while paused.
      this.musicTimer = setInterval(() => this.pumpMusic(), 200);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.32;
  }

  setMusicEnabled(on) {
    this.musicOn = on;
    if (this.musicGain) {
      this.musicGain.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.4);
    }
  }

  setScene(scene, depth) {
    this.scene = scene;
    if (depth) this.depth = depth;
  }

  updateListener(x, y, angle) {
    this.listener = { x, y, angle };
  }

  // --- generative music -----------------------------------------------------

  pumpMusic() {
    if (!this.ctx || !this.musicOn || this.muted) return;
    if (this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    if (this.nextBar < now - 4) this.nextBar = now + 0.05; // tab slept; resync
    while (this.nextBar < now + 0.8) {
      this.scheduleBar(this.nextBar);
      this.nextBar += 1.6;
      this.bar++;
    }
  }

  // The root sinks a semitone every couple of depths, one octave at most, so
  // depth 15 literally sounds lower than depth 1.
  rootHz() {
    return 110 * Math.pow(2, -Math.min(12, Math.floor((this.depth - 1) / 2)) / 12);
  }

  scheduleBar(t) {
    const scene = this.scene;
    const root = this.rootHz();
    const scale = scene === 'combat' || scene === 'boss' ? SCALES.tense : SCALES.calm;
    const note = (deg, oct = 0) => root * Math.pow(2, (scale[deg % scale.length] + 12 * oct) / 12);

    // Drone: two detuned saws through a dark lowpass, overlapping bar to bar.
    const droneGain = scene === 'boss' ? 0.055 : scene === 'combat' ? 0.045 : 0.038;
    this.mtone({ t, freq: root / 2, type: 'sawtooth', dur: 3.6, gain: droneGain, lp: 260, attack: 0.8 });
    this.mtone({ t, freq: root / 2, type: 'sawtooth', dur: 3.6, gain: droneGain * 0.8, lp: 220, attack: 0.8, detune: 9 });
    if (scene === 'boss') {
      this.mtone({ t, freq: root / 4, type: 'sine', dur: 3.4, gain: 0.09, attack: 0.5 });
    }

    if (scene === 'calm' || scene === 'explore') {
      // Sparse pad notes and the odd high sparkle. Silence is part of the texture.
      if (this.bar % 2 === 0 || Math.random() < 0.3) {
        this.mtone({
          t: t + Math.random() * 0.6, freq: note((Math.random() * 5) | 0, 1),
          type: 'triangle', dur: 2.6, gain: 0.028, lp: 900, attack: 0.9,
        });
      }
      if (Math.random() < 0.22) {
        this.mtone({
          t: t + Math.random() * 1.2, freq: note((Math.random() * 4) | 0, 3),
          type: 'sine', dur: 1.8, gain: 0.012, attack: 0.4,
        });
      }
    } else {
      // Combat: a low pulse marks time; boss doubles the rate and adds a motif.
      const pulses = scene === 'boss' ? 8 : 4;
      for (let i = 0; i < pulses; i++) {
        if (scene === 'combat' && i % 2 === 1 && Math.random() < 0.4) continue;
        this.mtone({
          t: t + (i / pulses) * 1.6, freq: root, type: 'square',
          dur: 0.09, gain: scene === 'boss' ? 0.035 : 0.027, lp: 420, attack: 0.005,
        });
      }
      this.mtone({
        t: t + Math.random() * 0.4, freq: note(this.bar % 2 === 0 ? 1 : 3, 1),
        type: 'triangle', dur: 1.6, gain: 0.03, lp: 1100, attack: 0.3,
      });
      if (scene === 'boss' && this.bar % 4 === 0) {
        // Three-note falling figure — the Warden's motif.
        for (let i = 0; i < 3; i++) {
          this.mtone({
            t: t + i * 0.5, freq: note(4 - i * 2 < 0 ? 0 : 4 - i * 2, 2),
            type: 'triangle', dur: 0.55, gain: 0.035, lp: 1400, attack: 0.03,
          });
        }
      }
    }
  }

  // Music voice: soft attack/decay envelope into the music bus, with an
  // optional lowpass so the drones stay felt more than heard.
  mtone({ t, freq, type = 'sine', dur = 1, gain = 0.05, attack = 0.05, lp = 0, detune = 0 }) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    if (detune) osc.detune.value = detune;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + Math.min(attack, dur * 0.5));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let head = osc;
    if (lp) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = lp;
      osc.connect(f);
      head = f;
    }
    head.connect(g).connect(this.musicGain);
    osc.start(t);
    osc.stop(t + dur + 0.1);
  }

  // --- effects ---------------------------------------------------------------

  tone({ freq = 440, to = null, type = 'sine', dur = 0.2, gain = 0.3, delay = 0, detune = 0 }) {
    const ctx = this.ensure();
    if (!ctx || this.muted) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t0 + dur);
    if (detune) osc.detune.value = detune;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + Math.min(0.02, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(this._out || this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  noise({ dur = 0.2, gain = 0.3, freq = 900, q = 1, type = 'bandpass', sweepTo = null, delay = 0 }) {
    const ctx = this.ensure();
    if (!ctx || this.muted) return;
    const t0 = ctx.currentTime + delay;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filt = ctx.createBiquadFilter();
    filt.type = type;
    filt.frequency.setValueAtTime(freq, t0);
    filt.Q.value = q;
    if (sweepTo) filt.frequency.exponentialRampToValueAtTime(Math.max(40, sweepTo), t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filt).connect(g).connect(this._out || this.master);
    src.start(t0);
  }

  // Pan and attenuate by direction and distance from the listener, so a
  // crawler scraping up behind you is audible before it is visible.
  spatialBus(pos) {
    const ctx = this.ctx;
    if (!pos || !this.listener || !ctx || !ctx.createStereoPanner) return null;
    const dx = pos.x - this.listener.x, dy = pos.y - this.listener.y;
    const dist = Math.hypot(dx, dy);
    const rel = Math.atan2(dy, dx) - this.listener.angle;
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.max(-1, Math.min(1, Math.sin(rel) * 0.75));
    const g = ctx.createGain();
    g.gain.value = Math.max(0.12, Math.min(1, 1 - dist / 22));
    g.connect(pan).connect(this.master);
    return g;
  }

  castSound(spell) {
    switch (spell.school) {
      case 'fire':
        this.noise({ dur: 0.28, gain: 0.26, freq: 1600, sweepTo: 320, q: 0.8 });
        this.tone({ freq: 190, to: 70, type: 'sawtooth', dur: 0.22, gain: 0.14 });
        break;
      case 'frost':
        this.tone({ freq: 1500, to: 900, type: 'triangle', dur: 0.18, gain: 0.16 });
        this.tone({ freq: 2300, to: 1700, type: 'sine', dur: 0.14, gain: 0.1, delay: 0.02 });
        break;
      case 'storm':
        this.noise({ dur: 0.12, gain: 0.28, freq: 3200, q: 0.6, sweepTo: 800 });
        this.tone({ freq: 820, to: 240, type: 'square', dur: 0.1, gain: 0.1 });
        break;
      case 'arcane':
        this.tone({ freq: 660, to: 990, type: 'sine', dur: 0.26, gain: 0.16 });
        this.tone({ freq: 1320, type: 'sine', dur: 0.2, gain: 0.07, delay: 0.03 });
        break;
      default:
        this.tone({ freq: 150, to: 90, type: 'sawtooth', dur: 0.3, gain: 0.16, detune: 12 });
        this.noise({ dur: 0.25, gain: 0.12, freq: 500, sweepTo: 180 });
    }
  }

  play(name, pos = null) {
    const ctx = this.ensure();
    if (!ctx || this.muted) return;
    this._out = pos ? this.spatialBus(pos) : null;
    switch (name) {
      case 'impact': this.noise({ dur: 0.1, gain: 0.18, freq: 1400, sweepTo: 500 }); break;
      case 'boom':
        this.noise({ dur: 0.5, gain: 0.4, freq: 700, sweepTo: 90, q: 0.6 });
        this.tone({ freq: 120, to: 40, type: 'sine', dur: 0.4, gain: 0.25 });
        break;
      case 'kill':
        this.tone({ freq: 320, to: 90, type: 'triangle', dur: 0.25, gain: 0.16 });
        this.noise({ dur: 0.18, gain: 0.14, freq: 900, sweepTo: 200 });
        break;
      case 'bossDeath':
        this.tone({ freq: 180, to: 45, type: 'sawtooth', dur: 1.4, gain: 0.3 });
        this.noise({ dur: 1.2, gain: 0.3, freq: 500, sweepTo: 60, q: 0.5 });
        break;
      case 'hurt':
        this.tone({ freq: 240, to: 110, type: 'square', dur: 0.16, gain: 0.2 });
        this.noise({ dur: 0.2, gain: 0.2, freq: 380, sweepTo: 140 });
        break;
      case 'playerHit': this.noise({ dur: 0.12, gain: 0.16, freq: 800, sweepTo: 260 }); break;
      case 'swipe': this.noise({ dur: 0.14, gain: 0.14, freq: 2200, sweepTo: 600, q: 0.7 }); break;
      case 'enemyShot': this.tone({ freq: 420, to: 260, type: 'square', dur: 0.12, gain: 0.09 }); break;
      case 'shatter':
        this.noise({ dur: 0.3, gain: 0.28, freq: 3400, sweepTo: 900, q: 0.5 });
        this.tone({ freq: 1900, to: 600, type: 'triangle', dur: 0.22, gain: 0.14 });
        break;
      case 'zap':
        this.noise({ dur: 0.14, gain: 0.2, freq: 2800, sweepTo: 700, q: 0.7 });
        this.tone({ freq: 980, to: 320, type: 'square', dur: 0.1, gain: 0.08 });
        break;
      case 'seal':
        this.tone({ freq: 90, to: 240, type: 'sawtooth', dur: 0.7, gain: 0.2 });
        this.noise({ dur: 0.6, gain: 0.16, freq: 300, sweepTo: 900 });
        break;
      case 'unseal':
        this.tone({ freq: 300, to: 900, type: 'sine', dur: 0.5, gain: 0.16 });
        this.tone({ freq: 450, to: 1350, type: 'sine', dur: 0.5, gain: 0.1, delay: 0.06 });
        break;
      case 'portal':
        this.tone({ freq: 220, to: 1320, type: 'sine', dur: 0.9, gain: 0.2 });
        this.noise({ dur: 0.8, gain: 0.12, freq: 400, sweepTo: 2600 });
        break;
      case 'boss':
        this.tone({ freq: 70, to: 52, type: 'sawtooth', dur: 1.6, gain: 0.3 });
        this.tone({ freq: 105, to: 78, type: 'square', dur: 1.4, gain: 0.12, delay: 0.1 });
        break;
      case 'pickup':
        this.tone({ freq: 880, to: 1320, type: 'sine', dur: 0.16, gain: 0.16 });
        break;
      case 'reward':
        this.tone({ freq: 523, type: 'sine', dur: 0.3, gain: 0.14 });
        this.tone({ freq: 784, type: 'sine', dur: 0.35, gain: 0.12, delay: 0.08 });
        this.tone({ freq: 1046, type: 'sine', dur: 0.4, gain: 0.1, delay: 0.16 });
        break;
      case 'fizzle': this.tone({ freq: 300, to: 140, type: 'triangle', dur: 0.1, gain: 0.07 }); break;
      case 'blink': this.tone({ freq: 1200, to: 300, type: 'sine', dur: 0.16, gain: 0.12 }); break;
      case 'death':
        this.tone({ freq: 200, to: 40, type: 'sawtooth', dur: 1.8, gain: 0.28 });
        this.noise({ dur: 1.6, gain: 0.2, freq: 400, sweepTo: 50, q: 0.4 });
        break;
      case 'select': this.tone({ freq: 660, type: 'sine', dur: 0.1, gain: 0.1 }); break;
      default: break;
    }
    this._out = null;
  }
}

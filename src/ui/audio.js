// Everything is synthesised on the fly — no audio files to ship.
export class Audio {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }

  ensure() {
    if (!this.ctx) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return null;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.32;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.32;
  }

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
    osc.connect(g).connect(this.master);
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
    src.connect(filt).connect(g).connect(this.master);
    src.start(t0);
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

  play(name) {
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
  }
}

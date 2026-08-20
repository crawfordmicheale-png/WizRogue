const BINDINGS = {
  KeyW: 'forward', ArrowUp: 'forward',
  KeyS: 'back', ArrowDown: 'back',
  KeyA: 'left', KeyD: 'right',
  ArrowLeft: 'turnLeft', ArrowRight: 'turnRight',
  ShiftLeft: 'sprint', ShiftRight: 'sprint',
  Space: 'cast',
  Digit1: 'slot1', Digit2: 'slot2', Digit3: 'slot3', Digit4: 'slot4', Digit5: 'slot5',
};

const clamp1 = (v) => (v < -1 ? -1 : v > 1 ? 1 : v);

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.held = new Set();
    this.justPressed = new Set();
    this.lookX = 0;
    this.lookY = 0;
    this.wheel = 0;
    this.locked = false;
    this.onPause = null;
    this.onEscape = null;
    this.onTouchMode = null;

    // Analog contribution from the on-screen stick, each axis in [-1, 1].
    this.stickF = 0;
    this.stickS = 0;

    // Gamepad state. padActive turns on the moment a pad produces input and is
    // what enables aim assist for controller players.
    this.padF = 0;
    this.padS = 0;
    this.padActive = false;
    this.padHeld = new Set();
    this.padPrev = [];

    // Coarse pointers get touch controls up front; a hybrid device flips over
    // the first time the screen is actually touched. `?touch` forces it on.
    this.touch = (window.matchMedia && window.matchMedia('(pointer: coarse)').matches)
      || /[?&]touch\b/.test(window.location.search);
    window.addEventListener('touchstart', () => this.enableTouch(), { once: true, passive: true });

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape') { this.onEscape?.(); return; }
      const action = BINDINGS[e.code];
      if (!action) return;
      e.preventDefault();
      if (!this.held.has(action)) this.justPressed.add(action);
      this.held.add(action);
    });
    window.addEventListener('keyup', (e) => {
      const action = BINDINGS[e.code];
      if (action) this.held.delete(action);
    });
    window.addEventListener('blur', () => this.held.clear());

    canvas.addEventListener('mousedown', (e) => {
      if (this.touch) return;
      if (e.button === 0) { this.held.add('cast'); this.justPressed.add('cast'); }
      if (e.button === 2) { this.held.add('altCast'); this.justPressed.add('altCast'); }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.held.delete('cast');
      if (e.button === 2) this.held.delete('altCast');
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('wheel', (e) => { this.wheel += Math.sign(e.deltaY); }, { passive: true });

    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.lookX += e.movementX || 0;
      this.lookY += e.movementY || 0;
    });
    document.addEventListener('pointerlockchange', () => {
      const wasLocked = this.locked;
      this.locked = document.pointerLockElement === canvas;
      if (wasLocked && !this.locked) this.onPause?.();
    });
  }

  enableTouch() {
    if (this.touch) return;
    this.touch = true;
    this.releaseLock();
    this.onTouchMode?.();
  }

  requestLock() {
    if (this.touch) return;
    if (!this.locked && this.canvas.requestPointerLock) {
      const r = this.canvas.requestPointerLock();
      if (r && typeof r.catch === 'function') r.catch(() => {});
    }
  }

  releaseLock() {
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  down(action) { return this.held.has(action); }
  pressed(action) { return this.justPressed.has(action); }

  // Programmatic press/release, used by the on-screen touch controls.
  press(action) {
    if (!this.held.has(action)) this.justPressed.add(action);
    this.held.add(action);
  }
  release(action) { this.held.delete(action); }
  pressSlot(i) { this.justPressed.add(`slot${i + 1}`); }
  addLook(dx, dy) { this.lookX += dx; this.lookY += dy; }

  // Keys are digital, the stick and gamepad analog; all feed the same axes.
  moveAxes() {
    const f = (this.down('forward') ? 1 : 0) - (this.down('back') ? 1 : 0) + this.stickF + this.padF;
    const s = (this.down('right') ? 1 : 0) - (this.down('left') ? 1 : 0) + this.stickS + this.padS;
    return { f: clamp1(f), s: clamp1(s) };
  }

  // --- gamepad -------------------------------------------------------------
  // Standard mapping: left stick moves, right stick looks, A or RT casts,
  // LB/RB cycle spells, LT or L3 sprints, Start pauses.
  pollGamepad(dt) {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return;
    let gp = null;
    for (const cand of navigator.getGamepads()) {
      if (cand && cand.connected) { gp = cand; break; }
    }
    if (!gp) {
      if (this.padF || this.padS) { this.padF = 0; this.padS = 0; }
      for (const a of this.padHeld) this.held.delete(a);
      this.padHeld.clear();
      return;
    }

    const dz = (v) => (Math.abs(v) < 0.18 ? 0 : (v - Math.sign(v) * 0.18) / 0.82);
    this.padS = dz(gp.axes[0] || 0);
    this.padF = -dz(gp.axes[1] || 0);
    const lx = dz(gp.axes[2] || 0);
    const ly = dz(gp.axes[3] || 0);
    this.lookX += lx * Math.abs(lx) * dt * 1500;
    this.lookY += ly * Math.abs(ly) * dt * 1000;

    const pressed = (i) => !!(gp.buttons[i] && gp.buttons[i].pressed);
    const padSet = (action, on) => {
      if (on && !this.padHeld.has(action)) {
        this.padHeld.add(action);
        this.press(action);
      } else if (!on && this.padHeld.has(action)) {
        this.padHeld.delete(action);
        this.held.delete(action);
      }
    };
    padSet('cast', pressed(0) || pressed(7));
    padSet('sprint', pressed(6) || pressed(10));

    const edge = (i) => pressed(i) && !this.padPrev[i];
    if (edge(5)) this.wheel += 1;
    if (edge(4)) this.wheel -= 1;
    if (edge(9)) this.onEscape?.();
    this.padPrev = gp.buttons.map((b) => b.pressed);

    if (lx || ly || this.padF || this.padS || pressed(0) || pressed(7)) this.padActive = true;
  }

  // Arrow keys turn the view when someone would rather not use the mouse.
  keyboardTurn(dt) {
    const t = (this.down('turnRight') ? 1 : 0) - (this.down('turnLeft') ? 1 : 0);
    if (t) this.lookX += t * dt * 900;
  }

  consumeLook() { this.lookX = 0; this.lookY = 0; }
  consumeWheel() { const w = this.wheel; this.wheel = 0; return w; }
  endFrame() { this.justPressed.clear(); }
}

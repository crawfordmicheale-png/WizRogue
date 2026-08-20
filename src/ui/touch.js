import { SPELLS, SCHOOLS } from '../game/spells.js';

const STICK_RADIUS = 52;    // px of thumb travel that maps to full speed
const SPRINT_EDGE = 0.94;   // stick deflection past this sprints
const LOOK_SCALE = 2.6;     // touch px -> equivalent mouse px

// On-screen controls for phones and tablets: a floating stick on the left
// half, drag-to-look on the right half, a cast button with a cooldown ring,
// and a pause chip. Everything writes into the shared Input instance so the
// simulation never knows the difference.
export class TouchControls {
  constructor(root, input, { onPause } = {}) {
    this.input = input;
    this.el = root.getElementById('touch');
    this.stick = root.getElementById('stick');
    this.nub = this.stick.querySelector('.stick-nub');
    this.castBtn = root.getElementById('castBtn');
    this.castGlyph = this.castBtn.querySelector('.glyph');
    this.castRing = this.castBtn.querySelector('.ring');
    this.movePointer = null;
    this.lookPointer = null;
    this.origin = { x: 0, y: 0 };
    this.lastLook = { x: 0, y: 0 };
    this.castSig = null;
    this.ringFrac = -1;

    root.getElementById('pauseBtn').addEventListener('click', (e) => {
      e.preventDefault();
      onPause?.();
    });

    const moveZone = this.el.querySelector('.tzone.move');
    moveZone.addEventListener('pointerdown', (e) => {
      if (this.movePointer !== null) return;
      e.preventDefault();
      this.movePointer = e.pointerId;
      moveZone.setPointerCapture(e.pointerId);
      this.origin = { x: e.clientX, y: e.clientY };
      this.stick.style.left = `${e.clientX}px`;
      this.stick.style.top = `${e.clientY}px`;
      this.stick.classList.add('on');
      this.setStick(0, 0);
    });
    moveZone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.movePointer) return;
      let vx = e.clientX - this.origin.x;
      let vy = e.clientY - this.origin.y;
      const d = Math.hypot(vx, vy);
      if (d > STICK_RADIUS) { vx *= STICK_RADIUS / d; vy *= STICK_RADIUS / d; }
      this.setStick(vx, vy);
    });
    const endMove = (e) => {
      if (e.pointerId !== this.movePointer) return;
      this.movePointer = null;
      this.stick.classList.remove('on');
      this.setStick(0, 0);
    };
    moveZone.addEventListener('pointerup', endMove);
    moveZone.addEventListener('pointercancel', endMove);

    const lookZone = this.el.querySelector('.tzone.look');
    lookZone.addEventListener('pointerdown', (e) => {
      if (this.lookPointer !== null) return;
      e.preventDefault();
      this.lookPointer = e.pointerId;
      lookZone.setPointerCapture(e.pointerId);
      this.lastLook = { x: e.clientX, y: e.clientY };
    });
    lookZone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.lookPointer) return;
      this.input.addLook((e.clientX - this.lastLook.x) * LOOK_SCALE, (e.clientY - this.lastLook.y) * LOOK_SCALE);
      this.lastLook = { x: e.clientX, y: e.clientY };
    });
    const endLook = (e) => { if (e.pointerId === this.lookPointer) this.lookPointer = null; };
    lookZone.addEventListener('pointerup', endLook);
    lookZone.addEventListener('pointercancel', endLook);

    this.castBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.castBtn.setPointerCapture(e.pointerId);
      this.castBtn.classList.add('down');
      this.input.press('cast');
    });
    const endCast = () => {
      this.castBtn.classList.remove('down');
      this.input.release('cast');
    };
    this.castBtn.addEventListener('pointerup', endCast);
    this.castBtn.addEventListener('pointercancel', endCast);
  }

  setStick(vx, vy) {
    this.nub.style.transform = `translate(calc(${vx}px - 50%), calc(${vy}px - 50%))`;
    this.input.stickS = vx / STICK_RADIUS;
    this.input.stickF = -vy / STICK_RADIUS;
    const mag = Math.hypot(vx, vy) / STICK_RADIUS;
    if (mag > SPRINT_EDGE) this.input.press('sprint');
    else this.input.release('sprint');
  }

  show(on) {
    const visible = on && this.input.touch;
    this.el.hidden = !visible;
    if (!visible) this.reset();
  }

  reset() {
    this.movePointer = null;
    this.lookPointer = null;
    this.stick.classList.remove('on');
    this.input.stickF = 0;
    this.input.stickS = 0;
    this.input.release('sprint');
    this.input.release('cast');
    this.castBtn.classList.remove('down');
  }

  // Mirror the selected spell onto the cast button: glyph, school colour,
  // a cooldown pie and a ready glow.
  sync(game) {
    if (this.el.hidden) return;
    const p = game.player;
    const entry = p.slots[p.selected];
    const spell = entry ? SPELLS[entry.id] : null;
    const sig = entry ? `${entry.id}:${p.selected}` : '-';
    if (sig !== this.castSig) {
      this.castSig = sig;
      this.castGlyph.textContent = spell ? spell.glyph : '✦';
      const c = spell ? SCHOOLS[spell.school].color : [200, 200, 220];
      this.castBtn.style.setProperty('--spell', `rgb(${c[0]},${c[1]},${c[2]})`);
    }
    const stats = entry ? p.statsFor(p.selected) : null;
    const frac = stats ? Math.max(0, Math.min(1, p.cooldowns[p.selected] / stats.cd)) : 0;
    if (Math.abs(frac - this.ringFrac) > 0.01) {
      this.ringFrac = frac;
      this.castRing.style.background = frac > 0
        ? `conic-gradient(rgba(5,3,12,0.72) ${frac * 360}deg, transparent 0)`
        : 'none';
    }
    this.castBtn.classList.toggle('ready', !!stats && frac <= 0 && p.mana >= stats.cost);
    this.castBtn.classList.toggle('broke', !!stats && p.mana < stats.cost);
  }
}

import { PLAYER, slotsForDepth } from '../config.js';
import { clamp } from '../util/rng.js';
import { spellStats } from './spells.js';
import { collides } from './enemies.js';
import { settings } from '../settings.js';

export class Player {
  constructor(archetype) {
    const st = archetype.stats;
    this.archetype = archetype;
    this.maxHealth = st.health;
    this.health = st.health;
    this.maxMana = st.mana;
    this.mana = st.mana;
    this.regen = st.regen;
    this.speedMul = st.speed || 1;
    this.mods = {
      cdMul: st.cdMul || 1,
      dmgMul: 1,
      costMul: 1,
      chillMul: st.chillMul || 1,
      schoolBonus: st.schoolBonus || {},
      leechBonus: st.leechBonus || 0,
    };
    // Loadout slots: two to begin with, five by the deep floors.
    this.slots = new Array(5).fill(null);
    this.unlocked = slotsForDepth(1);
    archetype.spells.forEach((id, i) => { if (i < this.unlocked) this.slots[i] = { id, rank: 1 }; });
    this.cooldowns = new Array(5).fill(0);
    this.selected = 0;

    this.x = 0; this.y = 0; this.z = PLAYER.eye;
    this.angle = 0;
    this.pitch = 0;
    this.vx = 0; this.vy = 0;
    this.radius = PLAYER.radius;
    this.shield = 0;
    this.shieldTime = 0;
    this.invuln = 0;
    this.bob = 0;
    this.bobPhase = 0;
    this.kills = 0;
    this.castFlash = 0;
    this.castColor = [255, 255, 255];
    this.hurtFlash = 0;
    this.shake = 0;
  }

  placeAt(spawn) {
    this.x = spawn.x; this.y = spawn.y; this.angle = spawn.dir;
    this.vx = this.vy = 0;
  }

  statsFor(slotIndex) {
    const s = this.slots[slotIndex];
    if (!s) return null;
    return spellStats(s.id, s.rank, this.mods);
  }

  hasSpell(id) { return this.slots.some((s) => s && s.id === id); }

  addSpell(id) {
    for (let i = 0; i < this.unlocked; i++) {
      if (!this.slots[i]) { this.slots[i] = { id, rank: 1 }; return i; }
    }
    return -1;
  }

  replaceSpell(slotIndex, id) {
    this.slots[slotIndex] = { id, rank: 1 };
    this.cooldowns[slotIndex] = 0;
  }

  unlockSlotsFor(depth) {
    const next = slotsForDepth(depth);
    const gained = next - this.unlocked;
    this.unlocked = next;
    return gained;
  }

  select(i) {
    if (i < 0 || i >= this.unlocked) return false;
    if (!this.slots[i]) return false;
    this.selected = i;
    return true;
  }

  cycle(dir) {
    for (let step = 1; step <= 5; step++) {
      const i = (this.selected + dir * step + 25) % 5;
      if (i < this.unlocked && this.slots[i]) { this.selected = i; return; }
    }
  }

  heal(n) { this.health = Math.min(this.maxHealth, this.health + n); }
  restore(n) { this.mana = Math.min(this.maxMana, this.mana + n); }

  takeDamage(n) {
    if (this.invuln > 0) return 0;
    let left = n;
    if (this.shield > 0) {
      const absorbed = Math.min(this.shield, left);
      this.shield -= absorbed;
      left -= absorbed;
    }
    this.health -= left;
    this.invuln = PLAYER.invulnAfterHit;
    this.hurtFlash = Math.min(1, 0.35 + n / 60);
    this.shake = Math.min(1.2, this.shake + 0.25 + n / 120);
    return n;
  }

  update(dt, input, level) {
    if (this.invuln > 0) this.invuln -= dt;
    if (this.hurtFlash > 0) this.hurtFlash = Math.max(0, this.hurtFlash - dt * 2.4);
    if (this.castFlash > 0) this.castFlash = Math.max(0, this.castFlash - dt * 5);
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 2.2);
    if (this.shieldTime > 0) {
      this.shieldTime -= dt;
      if (this.shieldTime <= 0) this.shield = 0;
    }
    this.mana = Math.min(this.maxMana, this.mana + this.regen * dt);
    for (let i = 0; i < 5; i++) if (this.cooldowns[i] > 0) this.cooldowns[i] -= dt;

    // --- look ---
    const sens = PLAYER.mouseSens * settings.sens;
    this.angle += input.lookX * sens;
    this.pitch = clamp(this.pitch - input.lookY * sens * 0.85, -PLAYER.pitchLimit, PLAYER.pitchLimit);
    input.consumeLook();

    // --- ground movement with a little inertia ---
    // Axes are analog: keys give ±1, the touch stick anything in between.
    const axes = input.moveAxes();
    const sprint = input.down('sprint') ? PLAYER.sprintMul : 1;
    const target = PLAYER.speed * this.speedMul * sprint;
    const cos = Math.cos(this.angle), sin = Math.sin(this.angle);
    let dx = cos * axes.f - sin * axes.s;
    let dy = sin * axes.f + cos * axes.s;
    const len = Math.hypot(dx, dy);
    if (len > 1) { dx /= len; dy /= len; }

    const accel = PLAYER.accel * dt;
    this.vx += (dx * target - this.vx) * Math.min(1, accel);
    this.vy += (dy * target - this.vy) * Math.min(1, accel);
    if (len < 0.001) {
      const f = Math.exp(-PLAYER.friction * dt);
      this.vx *= f; this.vy *= f;
    }

    const mx = this.vx * dt, my = this.vy * dt;
    if (!collides(level, this.x + mx, this.y, this.radius)) this.x += mx; else this.vx = 0;
    if (!collides(level, this.x, this.y + my, this.radius)) this.y += my; else this.vy = 0;

    const speed = Math.hypot(this.vx, this.vy);
    this.bobPhase += dt * speed * 2.6;
    this.bob = Math.sin(this.bobPhase) * Math.min(1, speed / 4) * 2.4;
  }
}

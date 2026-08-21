import { generateLevel } from '../world/mapgen.js';
import { Player } from './player.js';
import { Enemy, collides } from './enemies.js';
import { SPELLS, spellStats, schoolColor } from './spells.js';
import { getArchetype } from './archetypes.js';
import { clamp, angleDelta, makeRng } from '../util/rng.js';
import { PLAYER, biomeForDepth } from '../config.js';
import { settings } from '../settings.js';
import { buzz } from '../ui/haptics.js';

const SPRITE_SCALE = 1.7;

export class Game {
  constructor(tex, audio, hooks = {}) {
    this.tex = tex;
    this.audio = audio;
    this.hooks = hooks;
    this.state = 'idle';
    this.time = 0;
    this.setRunRng(1);
    this.log = [];
  }

  // --- run lifecycle ------------------------------------------------------

  // Gameplay randomness (enemy aim, drops, wake-up stagger) runs off the run
  // seed rather than Math.random, so the same seed always plays out the same
  // way. That is what lets the headless sim in test/sim.mjs reproduce a
  // failure instead of hitting it once in every few runs.
  setRunRng(seed) {
    const rng = makeRng(seed ^ 0x5f356495);
    this.rng = rng;
    this.roll = () => rng.next();
  }

  startRun(archetypeId, seed = (Math.random() * 1e9) | 0) {
    this.seed = seed >>> 0;
    this.setRunRng(this.seed);
    this.archetype = getArchetype(archetypeId);
    this.player = new Player(this.archetype);
    this.depth = 0;
    this.runKills = 0;
    this.runTime = 0;
    this.log.length = 0;
    this.lastHitBy = null;
    this.synergySeen = {};
    this.hitMarker = 0;
    this.nextDepth();
  }

  // Resume a run saved at the top of a floor: rebuild that depth from the seed
  // (levels are deterministic), then lay the saved player state back on top.
  restoreRun(save) {
    this.seed = save.seed >>> 0;
    this.setRunRng(this.seed);
    this.archetype = getArchetype(save.archetypeId);
    this.player = new Player(this.archetype);
    this.depth = save.depth - 1;
    this.runKills = save.runKills || 0;
    this.runTime = save.runTime || 0;
    this.log.length = 0;
    this.lastHitBy = null;
    this.synergySeen = {};
    this.hitMarker = 0;
    this.nextDepth();
    const p = this.player;
    const s = save.player;
    p.maxHealth = s.maxHealth; p.health = s.health;
    p.maxMana = s.maxMana; p.mana = s.mana;
    p.regen = s.regen; p.speedMul = s.speedMul;
    p.kills = s.kills || 0;
    p.mods = { ...p.mods, ...s.mods, schoolBonus: { ...(s.mods?.schoolBonus || {}) } };
    p.slots = s.slots.map((entry) => (entry ? { ...entry } : null));
    if (!p.slots[p.selected]) p.cycle(1);
    this.pushLog('You pick up where the corridor left you', '#9d94c4');
  }

  nextDepth() {
    this.depth++;
    const gained = this.player.unlockSlotsFor(this.depth);
    const biome = biomeForDepth(this.depth);
    const newBiome = biome !== this.biome;
    this.biome = biome;
    this.level = generateLevel((this.seed + this.depth * 7919) >>> 0, this.depth);
    this.enemies = [];
    this.projectiles = [];
    this.particles = [];
    this.beams = [];
    this.corpses = [];
    this.floaters = [];
    this.lightUndo = [];   // indices into the old level's lightmap are now invalid
    this.player.placeAt(this.level.spawn);
    this.player.shake = 0;
    for (const w of this.level.wanderers) this.spawn(w.id, w.x, w.y, null);
    this.state = 'playing';
    this.portalReady = true;
    this.pushLog(`Depth ${this.depth}`, '#9fd8ff');
    if (newBiome && this.depth > 1) this.pushLog(`You descend into ${biome.name}`, '#b9a8ff');
    if (this.depth === 1) {
      const touch = typeof document !== 'undefined' && document.body.classList.contains('touch');
      this.pushLog(touch ? 'Hold ✦ to cast · tap a slot to switch' : 'Click or Space to cast · 1-5 to switch', '#9d94c4');
      this.pushLog('Follow the corridor to the portal', '#9d94c4');
    }
    if (gained > 0) this.pushLog(`Loadout slot ${this.player.unlocked} unlocked`, '#ffd76a');
    this.hooks.onDepth?.(this.depth);
  }

  spawn(typeId, x, y, encounter, elite = null) {
    const e = new Enemy(typeId, x, y, this.depth, elite, this.roll);
    e.encounter = encounter;
    this.enemies.push(e);
    return e;
  }

  pushLog(text, color = '#dcd6ff') {
    this.log.push({ text, color, t: this.time });
    if (this.log.length > 5) this.log.shift();
  }

  // --- simulation ---------------------------------------------------------

  update(dt, input) {
    if (this.state !== 'playing') return;
    this.time += dt;
    this.runTime += dt;
    const p = this.player;

    p.update(dt, input, this.level);
    if ((input.touch || input.padActive) && settings.aimAssist) this.aimAssist(dt);
    this.handleInput(input);
    this.updateEncounters();

    for (const e of this.enemies) e.update(dt, this);
    this.updateProjectiles(dt);
    this.updateParticles(dt);
    this.updateCorpses(dt);
    this.updateFloaters(dt);
    this.updateDynamicLight();
    this.updatePickups();
    if (this.hitMarker > 0) this.hitMarker -= dt;
    this.enemies = this.enemies.filter((e) => !e.dead);

    if (p.health <= 0) this.die();
    else this.checkPortal();
  }

  // Thumbs and sticks cannot aim like a mouse, so the view leans gently toward
  // the nearest enemy already close to the crosshair. Never snaps, never fights
  // an intentional turn — the pull per frame is a fraction of the error.
  aimAssist(dt) {
    const p = this.player;
    const target = this.nearestEnemyInCone(p.x, p.y, p.angle, 11, 0.42);
    if (!target || !this.hasLineOfSight(p.x, p.y, target.x, target.y)) return;
    const err = angleDelta(p.angle, Math.atan2(target.y - p.y, target.x - p.x));
    p.angle += clamp(err, -1, 1) * Math.min(0.3, dt * 2.5);
  }

  handleInput(input) {
    const p = this.player;
    for (let i = 0; i < 5; i++) if (input.pressed(`slot${i + 1}`)) p.select(i);
    const wheel = input.consumeWheel();
    if (wheel) p.cycle(wheel > 0 ? 1 : -1);
    if (input.pressed('altCast')) p.cycle(1);   // right click steps to the next spell
    if (input.down('cast')) this.tryCast(p.selected);
  }

  updateEncounters() {
    const p = this.player;
    for (const enc of this.level.encounters) {
      if (enc.cleared) continue;
      if (!enc.triggered) {
        const b = enc.bounds;
        if (p.x > b.x0 && p.x < b.x1 + 1 && p.y > b.y0 && p.y < b.y1 + 1) this.triggerEncounter(enc);
        continue;
      }
      const alive = this.enemies.some((e) => e.encounter === enc && !e.dead);
      if (!alive) this.clearEncounter(enc);
    }
  }

  triggerEncounter(enc) {
    if (enc.triggered) return;
    enc.triggered = true;
    enc.spawns.forEach((s, i) => {
      const e = this.spawn(s.id, s.x, s.y, enc, s.elite);
      e.readyIn = i * 0.35 + this.roll() * 0.4;
    });
    for (const seal of enc.seals) {
      const b = this.level.barriers.get(`${seal.x},${seal.y}`);
      if (b && !b.open) b.active = true;
    }
    this.audio?.play(enc.kind === 'boss' ? 'boss' : 'seal');
    this.pushLog(enc.kind === 'boss' ? 'The Warden stirs' : 'The way seals behind you', '#ff9a6a');
    this.hooks.onEncounter?.(enc);
  }

  clearEncounter(enc) {
    enc.cleared = true;
    for (const seal of enc.seals) {
      const b = this.level.barriers.get(`${seal.x},${seal.y}`);
      if (b) { b.active = false; b.open = true; }
    }
    this.audio?.play('unseal');
    this.pushLog('The seals fall away', '#8affc4');
  }

  checkPortal() {
    const bossLive = this.level.encounters.some((e) => e.kind === 'boss' && !e.cleared);
    const d = Math.hypot(this.player.x - this.level.portal.x, this.player.y - this.level.portal.y);
    this.portalReady = !bossLive;
    if (!bossLive && d < 0.85) {
      this.state = 'reward';
      this.audio?.play('portal');
      this.hooks.onLevelClear?.(this.depth);
    }
  }

  die() {
    this.state = 'dead';
    this.audio?.play('death');
    this.hooks.onDeath?.({
      depth: this.depth,
      kills: this.runKills,
      time: this.runTime,
      archetype: this.archetype.name,
      seed: this.seed,
      killedBy: this.lastHitBy,
    });
  }

  // First time each synergy fires in a run, name it so the player learns the rule.
  synergyHint(key) {
    if (this.synergySeen?.[key]) return;
    this.synergySeen[key] = true;
    const text = {
      shatter: 'Shatter! Heavy blows break chilled foes',
      conflagrate: 'Conflagrate! Rot fuels fire for bonus damage',
      conduction: 'Conduction! Shock arcs onward when its host dies',
    }[key];
    if (text) this.pushLog(text, '#9fd8ff');
  }

  // --- casting ------------------------------------------------------------

  selectedColor() {
    const s = this.player.slots[this.player.selected];
    return s ? schoolColor(s.id) : [200, 200, 220];
  }

  tryCast(slot) {
    const p = this.player;
    const entry = p.slots[slot];
    if (!entry) return false;
    if (p.cooldowns[slot] > 0) return false;
    const s = spellStats(entry.id, entry.rank, p.mods);
    if (p.mana < s.cost) {
      if (this.time - (this.lastDryNote || -1) > 0.6) {
        this.lastDryNote = this.time;
        this.audio?.play('fizzle');
      }
      return false;
    }
    p.mana -= s.cost;
    p.cooldowns[slot] = s.cd;
    p.castFlash = 1;
    p.castColor = schoolColor(entry.id);

    switch (s.kind) {
      case 'bolt': this.castBolt(s); break;
      case 'beam': this.castBeam(s); break;
      case 'nova': this.castNova(s); break;
      case 'cone': this.castCone(s); break;
      case 'self': this.castSelf(s); break;
    }
    if (s.kind === 'bolt' || s.kind === 'beam' || s.kind === 'cone') {
      this.spawnMuzzleBurst(p.castColor);
    }
    this.audio?.castSound(s);
    buzz(8);
    return true;
  }

  // A handful of sparks thrown forward from the hands at the moment of release,
  // so every cast has a visible point of origin.
  spawnMuzzleBurst(color) {
    const p = this.player;
    const m = this.muzzle();
    for (let i = 0; i < 7; i++) {
      const a = p.angle + (Math.random() - 0.5) * 0.9;
      const sp = 1.5 + Math.random() * 3;
      this.particles.push({
        x: m.x, y: m.y, z: m.z + (Math.random() - 0.5) * 0.12,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: (Math.random() - 0.2) * 1.2,
        life: 0.12 + Math.random() * 0.14, maxLife: 0.26,
        color, size: 0.1 + Math.random() * 0.14, additive: true,
      });
    }
    // One short-lived flash quad right at the muzzle.
    this.particles.push({
      x: m.x, y: m.y, z: m.z, vx: 0, vy: 0, vz: 0,
      life: 0.09, maxLife: 0.09, color, size: 0.7, additive: true,
    });
  }

  muzzle() {
    const p = this.player;
    return {
      x: p.x + Math.cos(p.angle) * 0.35,
      y: p.y + Math.sin(p.angle) * 0.35,
      z: 0.45,
    };
  }

  castBolt(s) {
    const p = this.player;
    const m = this.muzzle();
    this.projectiles.push({
      x: m.x, y: m.y, z: m.z,
      vx: Math.cos(p.angle) * s.speed,
      vy: Math.sin(p.angle) * s.speed,
      r: s.radius, spell: s, friendly: true,
      life: 4, pierce: s.pierce || 0, hitIds: new Set(),
      color: schoolColor(s.id), size: 0.34 + (s.blast ? 0.16 : 0),
      trail: 0,
    });
  }

  castBeam(s) {
    const p = this.player;
    const origin = this.muzzle();
    const color = schoolColor(s.id);
    let from = origin;
    let target = this.rayPickEnemy(from.x, from.y, Math.cos(p.angle), Math.sin(p.angle), s.range);
    const hits = new Set();
    let power = 1;
    let jumps = (s.chains || 0) + 1;

    if (!target) {
      const end = this.rayWallHit(from.x, from.y, Math.cos(p.angle), Math.sin(p.angle), s.range);
      this.spawnBeam(from, end, color);
      return;
    }
    while (target && jumps-- > 0) {
      this.spawnBeam(from, { x: target.x, y: target.y, z: target.z }, color);
      const dealt = target.damage(s.dmg * power, this, { color });
      target.applyStatus(s);
      if (s.leech) this.player.heal(dealt * (s.leech + this.player.mods.leechBonus));
      if (s.manaGain) this.player.restore(s.manaGain);
      hits.add(target.id);
      from = { x: target.x, y: target.y, z: target.z };
      power *= s.chainFalloff || 1;
      target = s.chains ? this.nearestEnemy(from.x, from.y, s.chainRange, hits) : null;
    }
  }

  castNova(s) {
    const p = this.player;
    const color = schoolColor(s.id);
    this.spawnRing(p.x, p.y, 0.5, s.range, color);
    this.spawnRing(p.x, p.y, 0.25, s.range * 0.55, color);
    // Ground flash under the caster sells the detonation.
    this.particles.push({
      x: p.x, y: p.y, z: 0.1, vx: 0, vy: 0, vz: 0,
      life: 0.16, maxLife: 0.16, color, size: s.range * 0.9, additive: true,
    });
    this.player.shake = Math.min(1, this.player.shake + 0.35);
    for (const e of this.enemies) {
      if (e.dead) continue;
      const d = Math.hypot(e.x - p.x, e.y - p.y);
      if (d > s.range + e.radius) continue;
      if (!this.hasLineOfSight(p.x, p.y, e.x, e.y)) continue;
      e.damage(s.dmg * (1 - 0.35 * (d / s.range)), this, { color });
      e.applyStatus(s);
      if (s.knock) e.knockback(e.x - p.x, e.y - p.y, s.knock);
    }
  }

  castCone(s) {
    const p = this.player;
    const color = schoolColor(s.id);
    for (let i = 0; i < 26; i++) {
      const a = p.angle + (Math.random() - 0.5) * s.arc;
      const reach = Math.random() * s.range;
      this.particles.push({
        x: p.x + Math.cos(a) * 0.4, y: p.y + Math.sin(a) * 0.4, z: 0.45,
        vx: Math.cos(a) * (s.range * 1.4), vy: Math.sin(a) * (s.range * 1.4), vz: (Math.random() - 0.5) * 0.5,
        life: 0.18 + reach / s.range * 0.22, maxLife: 0.4,
        color, size: 0.5, additive: true,
      });
    }
    for (const e of this.enemies) {
      if (e.dead) continue;
      const dx = e.x - p.x, dy = e.y - p.y;
      const d = Math.hypot(dx, dy);
      if (d > s.range + e.radius) continue;
      if (Math.abs(angleDelta(p.angle, Math.atan2(dy, dx))) > s.arc / 2 + e.radius / Math.max(1, d)) continue;
      if (!this.hasLineOfSight(p.x, p.y, e.x, e.y)) continue;
      const dealt = e.damage(s.dmg, this, { color });
      e.applyStatus(s);
      if (s.leech) this.player.heal(dealt * (s.leech + this.player.mods.leechBonus));
      if (s.knock) e.knockback(dx, dy, s.knock);
    }
  }

  castSelf(s) {
    const p = this.player;
    if (s.effect === 'heal') {
      p.heal(s.heal);
      this.pushLog(`+${s.heal} vitality`, '#8affc4');
      this.spawnRing(p.x, p.y, 0.3, 1.4, [120, 255, 200]);
      this.spawnAura([120, 255, 200]);
    } else if (s.effect === 'shield') {
      p.shield = s.shield;
      p.shieldTime = s.time;
      this.spawnRing(p.x, p.y, 0.3, 1.2, [120, 255, 220]);
      this.spawnAura([120, 255, 220]);
      this.pushLog(`Ward: ${s.shield}`, '#78ffdc');
    } else if (s.effect === 'blink') {
      const steps = 24;
      const dx = Math.cos(p.angle) * (s.distance / steps);
      const dy = Math.sin(p.angle) * (s.distance / steps);
      let nx = p.x, ny = p.y;
      for (let i = 0; i < steps; i++) {
        const tx = nx + dx, ty = ny + dy;
        if (collides(this.level, tx, ty, p.radius)) break;
        nx = tx; ny = ty;
      }
      this.spawnRing(p.x, p.y, 0.2, 0.9, [140, 255, 235]);
      p.x = nx; p.y = ny;
      this.spawnRing(nx, ny, 0.2, 0.9, [140, 255, 235]);
    }
  }

  // --- projectiles --------------------------------------------------------

  spawnEnemyProjectile(enemy, angle, r) {
    // Keep the muzzle inside the gap to the player, or a close-range shot
    // would spawn on the far side of its target and sail away.
    const gap = Math.hypot(this.player.x - enemy.x, this.player.y - enemy.y);
    const off = Math.min(0.4, Math.max(0.05, gap * 0.4));
    this.projectiles.push({
      x: enemy.x + Math.cos(angle) * off,
      y: enemy.y + Math.sin(angle) * off,
      z: enemy.z,
      vx: Math.cos(angle) * r.speed,
      vy: Math.sin(angle) * r.speed,
      r: 0.22, dmg: r.dmg * enemy.type.dmgMul, friendly: false,
      life: 5, color: r.color || [255, 120, 120], size: 0.3,
      homing: r.homing || 0,
      ownerName: enemy.name,   // the shooter may be dead by the time this lands
    });
    this.audio?.play('enemyShot', { x: enemy.x, y: enemy.y });
  }

  updateProjectiles(dt) {
    const p = this.player;
    const out = [];
    for (const b of this.projectiles) {
      b.life -= dt;
      if (b.life <= 0) continue;

      const spell = b.spell;
      if (b.friendly && spell && spell.homing) {
        const target = this.nearestEnemyInCone(b.x, b.y, Math.atan2(b.vy, b.vx), 9, 1.2);
        if (target) {
          const want = Math.atan2(target.y - b.y, target.x - b.x);
          const cur = Math.atan2(b.vy, b.vx);
          const na = cur + clamp(angleDelta(cur, want), -spell.homing * dt, spell.homing * dt);
          const sp = Math.hypot(b.vx, b.vy);
          b.vx = Math.cos(na) * sp; b.vy = Math.sin(na) * sp;
        }
      } else if (!b.friendly && b.homing) {
        const want = Math.atan2(p.y - b.y, p.x - b.x);
        const cur = Math.atan2(b.vy, b.vx);
        const na = cur + clamp(angleDelta(cur, want), -b.homing * dt, b.homing * dt);
        const sp = Math.hypot(b.vx, b.vy);
        b.vx = Math.cos(na) * sp; b.vy = Math.sin(na) * sp;
      }

      // Substep so fast bolts cannot tunnel through a wall or a body.
      const speed = Math.hypot(b.vx, b.vy);
      const steps = Math.max(1, Math.ceil((speed * dt) / 0.2));
      const sdt = dt / steps;
      let alive = true;
      for (let i = 0; i < steps && alive; i++) {
        b.x += b.vx * sdt;
        b.y += b.vy * sdt;
        if (this.level.solid(Math.floor(b.x), Math.floor(b.y))) { this.impact(b, null); alive = false; break; }
        if (b.friendly) {
          for (const e of this.enemies) {
            if (e.dead || (b.hitIds && b.hitIds.has(e.id))) continue;
            if (Math.hypot(e.x - b.x, e.y - b.y) > e.radius + b.r) continue;
            this.impact(b, e);
            if (b.pierce > 0) { b.pierce--; b.hitIds.add(e.id); }
            else alive = false;
            break;
          }
        } else if (Math.hypot(p.x - b.x, p.y - b.y) < p.radius + b.r) {
          this.damagePlayer(b.dmg, b.ownerName);
          this.impact(b, null);
          alive = false;
        }
      }
      b.trail = (b.trail || 0) + dt;
      if (b.trail > 0.02) {
        b.trail = 0;
        this.particles.push({
          x: b.x, y: b.y, z: b.z, vx: 0, vy: 0, vz: 0,
          life: 0.22, maxLife: 0.22, color: b.color, size: b.size * 0.7, additive: true,
        });
      }
      if (alive) out.push(b);
    }
    this.projectiles = out;
  }

  impact(b, enemy) {
    const spell = b.spell;
    const color = b.color;
    if (enemy && spell) {
      const dealt = enemy.damage(spell.dmg, this, { color });
      enemy.applyStatus(spell);
      if (spell.leech) this.player.heal(dealt * (spell.leech + this.player.mods.leechBonus));
      if (spell.knock) enemy.knockback(b.vx, b.vy, spell.knock);
    }
    if (spell && spell.blast) {
      this.explode(b.x, b.y, spell, color, enemy);
      this.audio?.play('boom', { x: b.x, y: b.y });
    } else {
      this.spawnHitBurst(b.x, b.y, b.z, color, 7);
      // Brief flash quad at the point of impact.
      this.particles.push({
        x: b.x, y: b.y, z: b.z, vx: 0, vy: 0, vz: 0,
        life: 0.1, maxLife: 0.1, color, size: 0.85, additive: true,
      });
      this.audio?.play(b.friendly ? 'impact' : 'playerHit', b.friendly ? { x: b.x, y: b.y } : null);
    }
  }

  explode(x, y, spell, color, skip) {
    this.spawnRing(x, y, 0.3, spell.blast, color);
    // Core flash bigger than the ring so a detonation lights the corridor.
    this.particles.push({
      x, y, z: 0.5, vx: 0, vy: 0, vz: 0,
      life: 0.14, maxLife: 0.14, color, size: spell.blast * 0.9, additive: true,
    });
    this.particles.push({
      x, y, z: 0.5, vx: 0, vy: 0, vz: 0,
      life: 0.08, maxLife: 0.08, color: [255, 255, 255], size: spell.blast * 0.45, additive: true,
    });
    const p = this.player;
    if (Math.hypot(p.x - x, p.y - y) < spell.blast * 0.8) p.shake = Math.min(1.2, p.shake + 0.4);
    for (const e of this.enemies) {
      if (e.dead || e === skip) continue;
      const d = Math.hypot(e.x - x, e.y - y);
      if (d > spell.blast + e.radius) continue;
      const falloff = 1 - d / (spell.blast + e.radius);
      e.damage(spell.blastDmg * falloff, this, { color });
      e.applyStatus(spell);
      if (spell.knock) e.knockback(e.x - x, e.y - y, spell.knock * falloff);
      if (spell.pull) e.knockback(x - e.x, y - e.y, spell.pull * falloff);
    }
  }

  // --- queries ------------------------------------------------------------

  hasLineOfSight(x0, y0, x1, y1) {
    const dx = x1 - x0, dy = y1 - y0;
    const dist = Math.hypot(dx, dy);
    const steps = Math.ceil(dist / 0.25);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (this.level.solid(Math.floor(x0 + dx * t), Math.floor(y0 + dy * t))) return false;
    }
    return true;
  }

  rayWallHit(x, y, dx, dy, range) {
    const steps = Math.ceil(range / 0.1);
    for (let i = 1; i <= steps; i++) {
      const t = (i / steps) * range;
      const px = x + dx * t, py = y + dy * t;
      if (this.level.solid(Math.floor(px), Math.floor(py))) return { x: x + dx * (t - 0.12), y: y + dy * (t - 0.12), z: 0.5 };
    }
    return { x: x + dx * range, y: y + dy * range, z: 0.5 };
  }

  rayPickEnemy(x, y, dx, dy, range) {
    let best = null, bestT = Infinity;
    for (const e of this.enemies) {
      if (e.dead) continue;
      const ex = e.x - x, ey = e.y - y;
      const t = ex * dx + ey * dy;
      if (t < 0 || t > range) continue;
      const perp = Math.abs(ex * dy - ey * dx);
      if (perp > e.radius + 0.3) continue;
      if (t < bestT && this.hasLineOfSight(x, y, e.x, e.y)) { best = e; bestT = t; }
    }
    return best;
  }

  nearestEnemy(x, y, range, exclude) {
    let best = null, bestD = range;
    for (const e of this.enemies) {
      if (e.dead || (exclude && exclude.has(e.id))) continue;
      const d = Math.hypot(e.x - x, e.y - y);
      if (d < bestD && this.hasLineOfSight(x, y, e.x, e.y)) { best = e; bestD = d; }
    }
    return best;
  }

  nearestEnemyInCone(x, y, angle, range, arc) {
    let best = null, bestD = range;
    for (const e of this.enemies) {
      if (e.dead) continue;
      const d = Math.hypot(e.x - x, e.y - y);
      if (d > bestD) continue;
      if (Math.abs(angleDelta(angle, Math.atan2(e.y - y, e.x - x))) > arc) continue;
      best = e; bestD = d;
    }
    return best;
  }

  // --- feedback from enemies ---------------------------------------------

  damagePlayer(amount, source) {
    const dealt = this.player.takeDamage(amount);
    if (dealt > 0) {
      this.audio?.play('hurt');
      buzz(28);
      // Remember the killer for the death recap. Accepts an enemy or a name,
      // since projectiles can outlive whoever fired them.
      if (source) this.lastHitBy = typeof source === 'string' ? source : source.name;
    }
  }

  shovePlayer(dx, dy, force) {
    const len = Math.hypot(dx, dy) || 1;
    this.player.vx += (dx / len) * force;
    this.player.vy += (dy / len) * force;
  }

  blinkEnemy(enemy, dx, dy, dist) {
    for (let attempt = 0; attempt < 6; attempt++) {
      const a = Math.atan2(dy, dx) + (this.roll() - 0.5) * 1.6;
      const nx = enemy.x + Math.cos(a) * dist;
      const ny = enemy.y + Math.sin(a) * dist;
      if (collides(this.level, nx, ny, enemy.radius)) continue;
      this.spawnHitBurst(enemy.x, enemy.y, enemy.z, [190, 110, 255], 10);
      enemy.x = nx; enemy.y = ny;
      this.spawnHitBurst(nx, ny, enemy.z, [190, 110, 255], 10);
      this.audio?.play('blink', { x: nx, y: ny });
      return;
    }
  }

  onEnemyDeath(enemy) {
    this.runKills++;
    this.player.kills++;
    this.audio?.play(enemy.type.boss ? 'bossDeath' : 'kill', { x: enemy.x, y: enemy.y });
    buzz(enemy.type.boss ? [40, 50, 90] : 12);
    this.spawnHitBurst(enemy.x, enemy.y, enemy.z, [255, 190, 140], enemy.type.boss ? 40 : 14);

    // Conduction: shock does not die with its host — it arcs to the nearest foe.
    if (enemy.effects.shock > 0) {
      const next = this.nearestEnemy(enemy.x, enemy.y, 3.5, new Set([enemy.id]));
      if (next) {
        next.effects.shock = Math.max(next.effects.shock, enemy.effects.shock);
        next.effects.shockAmp = Math.max(next.effects.shockAmp, enemy.effects.shockAmp);
        this.spawnBeam({ x: enemy.x, y: enemy.y, z: enemy.z }, { x: next.x, y: next.y, z: next.z }, [255, 235, 130]);
        this.audio?.play('zap', { x: next.x, y: next.y });
        this.synergyHint('conduction');
      }
    }

    // Volatile elites go out with a bang that hurts everyone nearby.
    if (enemy.elite?.explode) {
      const bx = enemy.x, by = enemy.y;
      this.spawnRing(bx, by, 0.4, 2.2, [255, 170, 80]);
      this.particles.push({
        x: bx, y: by, z: 0.5, vx: 0, vy: 0, vz: 0,
        life: 0.14, maxLife: 0.14, color: [255, 180, 90], size: 2, additive: true,
      });
      this.audio?.play('boom', { x: bx, y: by });
      const p = this.player;
      const pd = Math.hypot(p.x - bx, p.y - by);
      if (pd < 2.4 && this.hasLineOfSight(bx, by, p.x, p.y)) {
        this.damagePlayer((12 + this.depth * 1.5) * (1 - pd / 3), 'a Volatile death-burst');
      }
      for (const other of this.enemies) {
        if (other.dead || other === enemy) continue;
        const d = Math.hypot(other.x - bx, other.y - by);
        if (d < 2.4) other.damage((14 + this.depth) * (1 - d / 3), this, { color: [255, 170, 80] });
      }
    }
    // Leave a dissolving corpse so the body doesn't just vanish mid-frame.
    const frames = this.tex?.sprites[enemy.type.sprite];
    if (frames) {
      this.corpses.push({
        x: enemy.x, y: enemy.y, z: enemy.z,
        size: enemy.height * SPRITE_SCALE,
        tex: frames[0],
        hover: !!enemy.type.hover,
        t: 0, dur: enemy.type.boss ? 0.9 : 0.5,
      });
    }
    if (enemy.type.boss) {
      this.pushLog(`The ${enemy.name} falls`, '#ffd76a');
      this.player.shake = 1;
    }
    // Small chance of a drop so long fights stay sustainable; elites always pay out.
    if (this.roll() < (enemy.type.boss || enemy.elite ? 1 : 0.16)) {
      this.level.props.push({
        kind: this.roll() < 0.5 ? 'health' : 'mana',
        x: enemy.x, y: enemy.y, z: 0.35, phase: 0, taken: false,
      });
    }
  }

  updatePickups() {
    const p = this.player;
    for (const prop of this.level.props) {
      if (prop.kind !== 'health' && prop.kind !== 'mana') continue;
      if (prop.taken) continue;
      if (Math.hypot(p.x - prop.x, p.y - prop.y) > 0.65) continue;
      prop.taken = true;
      if (prop.kind === 'health') { p.heal(28); this.pushLog('+28 vitality', '#ff6a86'); }
      else { p.restore(45); this.pushLog('+45 mana', '#6ec8ff'); }
      this.audio?.play('pickup');
    }
  }

  // --- particles ----------------------------------------------------------

  spawnHitBurst(x, y, z, color, count) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 0.8 + Math.random() * 3.2;
      this.particles.push({
        x, y, z, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: (Math.random() - 0.3) * 1.6,
        life: 0.25 + Math.random() * 0.3, maxLife: 0.55,
        color, size: 0.16 + Math.random() * 0.18, additive: true, gravity: 2.2,
      });
    }
  }

  spawnEmber(x, y, z, color) {
    this.particles.push({
      x: x + (Math.random() - 0.5) * 0.4, y: y + (Math.random() - 0.5) * 0.4, z: z + Math.random() * 0.3,
      vx: 0, vy: 0, vz: 0.7,
      life: 0.4, maxLife: 0.4, color, size: 0.12, additive: true,
    });
  }

  spawnRing(x, y, z, radius, color) {
    const n = Math.round(18 + radius * 8);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.2;
      this.particles.push({
        x, y, z: z + Math.random() * 0.4,
        vx: Math.cos(a) * radius * 3.2, vy: Math.sin(a) * radius * 3.2, vz: 0.2,
        life: 0.3, maxLife: 0.3, color, size: 0.3, additive: true,
      });
    }
  }

  spawnBeam(from, to, color) {
    const dx = to.x - from.x, dy = to.y - from.y;
    const fz = from.z === undefined ? 0.5 : from.z;
    const dz = (to.z === undefined ? 0.5 : to.z) - fz;
    const dist = Math.hypot(dx, dy);
    const n = Math.max(6, Math.round(dist * 10));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const px = from.x + dx * t, py = from.y + dy * t, pz = fz + dz * t;
      // Coloured sheath around a white-hot core, with the far end lingering a
      // touch longer so the beam reads as travelling outward.
      this.particles.push({
        x: px + (Math.random() - 0.5) * 0.1,
        y: py + (Math.random() - 0.5) * 0.1,
        z: pz + (Math.random() - 0.5) * 0.08,
        vx: 0, vy: 0, vz: 0.18,
        life: 0.12 + t * 0.07 + Math.random() * 0.08, maxLife: 0.27,
        color, size: 0.3, additive: true,
      });
      if ((i & 1) === 0) {
        this.particles.push({
          x: px, y: py, z: pz, vx: 0, vy: 0, vz: 0.1,
          life: 0.1 + t * 0.05, maxLife: 0.15,
          color: [255, 255, 255], size: 0.13, additive: true,
        });
      }
    }
  }

  // Rising motes around the caster for heals and wards.
  spawnAura(color) {
    const p = this.player;
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 0.35 + Math.random() * 0.4;
      this.particles.push({
        x: p.x + Math.cos(a) * r, y: p.y + Math.sin(a) * r, z: 0.1 + Math.random() * 0.3,
        vx: 0, vy: 0, vz: 0.9 + Math.random() * 0.7,
        life: 0.45 + Math.random() * 0.35, maxLife: 0.8,
        color, size: 0.09 + Math.random() * 0.1, additive: true,
      });
    }
  }

  spawnSwipe(enemy, target) {
    const a = Math.atan2(target.y - enemy.y, target.x - enemy.x);
    for (let i = 0; i < 10; i++) {
      const t = (i / 9 - 0.5) * 1.1;
      this.particles.push({
        x: enemy.x + Math.cos(a + t) * 0.8,
        y: enemy.y + Math.sin(a + t) * 0.8,
        z: 0.5, vx: Math.cos(a) * 2, vy: Math.sin(a) * 2, vz: 0,
        life: 0.16, maxLife: 0.16, color: [255, 120, 120], size: 0.22, additive: true,
      });
    }
    this.audio?.play('swipe', { x: enemy.x, y: enemy.y });
  }

  updateParticles(dt) {
    const out = [];
    for (const q of this.particles) {
      q.life -= dt;
      if (q.life <= 0) continue;
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      q.z += (q.vz || 0) * dt;
      if (q.gravity) q.vz = (q.vz || 0) - q.gravity * dt;
      if (q.z < 0.05) { q.z = 0.05; q.vz = 0; }
      const drag = Math.exp(-4 * dt);
      q.vx *= drag; q.vy *= drag;
      out.push(q);
    }
    this.particles = out;
  }

  updateCorpses(dt) {
    if (!this.corpses.length) return;
    const out = [];
    for (const c of this.corpses) {
      c.t += dt;
      if (c.t < c.dur) out.push(c);
    }
    this.corpses = out;
  }

  // --- floating damage numbers ---------------------------------------------

  addDamageNumber(enemy, amount, color) {
    if (amount < 1) return;
    // Rapid hits on the same target merge so beams don't paper the screen.
    for (const f of this.floaters) {
      if (f.key === enemy.id && f.t < 0.35) {
        f.value += amount;
        f.t = Math.min(f.t, 0.15);
        return;
      }
    }
    this.floaters.push({
      key: enemy.id,
      x: enemy.x + (Math.random() - 0.5) * 0.3,
      y: enemy.y + (Math.random() - 0.5) * 0.3,
      z: enemy.z + enemy.height * 0.55,
      value: amount,
      color: color || [255, 235, 200],
      t: 0, life: 0.8,
    });
    if (this.floaters.length > 24) this.floaters.shift();
  }

  updateFloaters(dt) {
    if (!this.floaters.length) return;
    const out = [];
    for (const f of this.floaters) {
      f.t += dt;
      f.z += dt * 0.55;
      if (f.t < f.life) out.push(f);
    }
    this.floaters = out;
  }

  // --- dynamic light ---------------------------------------------------------
  // Casts and projectiles stamp a temporary boost into the baked lightmap and
  // undo it next frame, so spells genuinely light the corridor as they travel.

  stampLight(x, y, radius, power) {
    const level = this.level;
    const light = level.light;
    const W = level.w, H = level.h;
    const x0 = Math.max(0, Math.floor(x - radius)), x1 = Math.min(W - 1, Math.ceil(x + radius));
    const y0 = Math.max(0, Math.floor(y - radius)), y1 = Math.min(H - 1, Math.ceil(y + radius));
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const d = Math.hypot(cx + 0.5 - x, cy + 0.5 - y);
        if (d > radius) continue;
        const i = cy * W + cx;
        const f = 1 - d / radius;
        this.lightUndo.push(i, light[i]);
        light[i] = Math.min(1.7, light[i] + power * f * f);
      }
    }
  }

  updateDynamicLight() {
    if (!this.tex) return; // headless sim doesn't render
    const light = this.level.light;
    // Reverse order: overlapping stamps on one cell must unwind last-to-first.
    for (let i = this.lightUndo.length - 2; i >= 0; i -= 2) {
      light[this.lightUndo[i]] = this.lightUndo[i + 1];
    }
    this.lightUndo.length = 0;

    const p = this.player;
    if (p.castFlash > 0) this.stampLight(p.x, p.y, 4, p.castFlash * 0.65);
    let budget = 14;
    for (const b of this.projectiles) {
      if (budget-- <= 0) break;
      this.stampLight(b.x, b.y, 2.6, b.friendly ? 0.5 : 0.35);
    }
  }

  // --- render feed --------------------------------------------------------

  collectSprites(time) {
    const out = [];
    const sprites = this.tex.sprites;

    for (const prop of this.level.props) {
      if (prop.kind === 'torch') {
        const frames = sprites.torch;
        out.push({
          x: prop.x, y: prop.y, z: prop.z,
          w: 0.85, h: 0.85, additive: true, tint: prop.hue,
          tex: frames[Math.floor((time * 11 + prop.phase) % frames.length)],
        });
      } else if (!prop.taken) {
        const frames = sprites[prop.kind];
        out.push({
          x: prop.x, y: prop.y,
          z: prop.z + Math.sin(time * 2.4 + prop.phase) * 0.07,
          w: 0.5, h: 0.5, additive: true, tex: frames[0],
        });
      }
    }

    const pf = sprites.portal;
    out.push({
      x: this.level.portal.x, y: this.level.portal.y, z: 0.85,
      w: 1.9, h: 2.4, additive: true,
      alpha: this.portalReady === false ? 0.35 : 1,
      tex: pf[Math.floor(time * 8) % pf.length],
    });

    for (const e of this.enemies) {
      if (e.dead) continue;
      const frames = sprites[e.type.sprite];
      const idx = Math.floor(e.bob * 0.9) % frames.length;
      const size = e.height * SPRITE_SCALE;
      let tint = null;
      if (e.effects.chill > 0) tint = [150, 210, 255];
      else if (e.effects.poison > 0) tint = [190, 255, 150];
      else if (e.effects.burn > 0) tint = [255, 190, 150];
      else if (e.elite) tint = e.elite.tint;
      else if (e.type.tintBase) tint = e.type.tintBase;
      out.push({
        x: e.x, y: e.y,
        z: e.z + (e.type.hover ? Math.sin(e.bob) * 0.09 : 0),
        w: size, h: size,
        tex: frames[idx],
        creature: true,
        tint,
        // A hit reads as a bright pulse, a wind-up as a red one — neither
        // should erase the creature you are trying to look at.
        flash: e.hitFlash > 0 ? 0.5 : (e.windup > 0 ? 0.34 : 0),
        flashColor: e.hitFlash > 0 ? undefined : [255, 110, 110],
      });
    }

    // Dissolving corpses: sink, shrink and fade.
    for (const c of this.corpses) {
      const k = c.t / c.dur;
      out.push({
        x: c.x, y: c.y,
        z: c.z - k * (c.hover ? 0.5 : 0.28),
        w: c.size * (1 - k * 0.25), h: c.size * (1 - k * 0.45),
        tex: c.tex,
        creature: true,
        alpha: 1 - k * k,
        tint: [200 - k * 110, 170 - k * 110, 220 - k * 90],
      });
    }

    // Bolts are a coloured glow around a white-hot core, with a subtle pulse.
    for (const b of this.projectiles) {
      const pulse = 1 + Math.sin(time * 16 + b.x * 5 + b.y * 3) * 0.14;
      out.push({
        x: b.x, y: b.y, z: b.z,
        w: b.size * 2.6 * pulse, h: b.size * 2.6 * pulse,
        tex: this.tex.glow, tint: b.color, additive: true,
      });
      out.push({
        x: b.x, y: b.y, z: b.z,
        w: b.size * 1.05, h: b.size * 1.05,
        tex: this.tex.glow, tint: [255, 255, 255], additive: true,
      });
    }

    for (const q of this.particles) {
      out.push({
        x: q.x, y: q.y, z: q.z,
        w: q.size, h: q.size,
        tex: this.tex.glow, tint: q.color, additive: true,
        alpha: Math.min(1, q.life / q.maxLife),
      });
    }

    return out;
  }

  // --- rewards ------------------------------------------------------------

  applyReward(reward) {
    const p = this.player;
    switch (reward.type) {
      case 'spell':
        if (reward.slot !== undefined) p.replaceSpell(reward.slot, reward.spellId);
        else p.addSpell(reward.spellId);
        this.pushLog(`Learned ${SPELLS[reward.spellId].name}`, '#ffd76a');
        break;
      case 'empower': {
        const entry = p.slots.find((s) => s && s.id === reward.spellId);
        if (entry) entry.rank++;
        this.pushLog(`${SPELLS[reward.spellId].name} empowered`, '#ffd76a');
        break;
      }
      case 'health': p.maxHealth += reward.amount; p.heal(reward.amount); break;
      case 'mana': p.maxMana += reward.amount; p.restore(reward.amount); break;
      case 'regen': p.regen += reward.amount; break;
      case 'speed': p.speedMul += reward.amount; break;
      case 'haste': p.mods.cdMul *= reward.amount; break;
      case 'power': p.mods.dmgMul *= reward.amount; break;
      case 'restore': p.heal(p.maxHealth); p.restore(p.maxMana); break;
    }
    this.audio?.play('reward');
  }
}

export { PLAYER };

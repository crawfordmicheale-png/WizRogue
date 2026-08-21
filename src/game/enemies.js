import { clamp, angleDelta } from '../util/rng.js';

// Base stats at depth 1. Everything scales from here.
export const ENEMY_TYPES = {
  crawler: {
    name: 'Crawler', hp: 22, speed: 2.7, radius: 0.3, height: 0.6, z: 0.3,
    melee: { dmg: 8, reach: 1.0, cd: 1.15, windup: 0.32 },
    aggro: 12, sprite: 'crawler', mass: 1,
  },
  wisp: {
    name: 'Wisp', hp: 22, speed: 2.1, radius: 0.3, height: 0.7, z: 0.8,
    ranged: { dmg: 7, speed: 7.5, cd: 2.0, range: 11, windup: 0.45, color: [150, 120, 255] },
    keepAway: 5.5, aggro: 13, sprite: 'wisp', mass: 0.7, hover: true,
  },
  brute: {
    name: 'Brute', hp: 95, speed: 1.55, radius: 0.46, height: 1.25, z: 0.62,
    melee: { dmg: 20, reach: 1.4, cd: 1.9, windup: 0.6, knock: 6 },
    aggro: 14, sprite: 'brute', mass: 3,
  },
  sentinel: {
    name: 'Sentinel', hp: 60, speed: 0, radius: 0.4, height: 0.95, z: 0.7,
    ranged: { dmg: 6, speed: 9, cd: 2.4, range: 15, windup: 0.55, burst: 3, spread: 0.16, color: [255, 170, 90] },
    aggro: 16, sprite: 'sentinel', mass: 99, hover: true,
  },
  warlock: {
    name: 'Warlock', hp: 78, speed: 2.2, radius: 0.34, height: 1.05, z: 0.58,
    ranged: { dmg: 12, speed: 6.5, cd: 2.5, range: 13, windup: 0.65, homing: 1.7, color: [190, 110, 255] },
    keepAway: 7, aggro: 15, sprite: 'warlock', mass: 1.4, teleport: 5,
  },
  warden: {
    // A five-shot burst at 16 base was up to 112 damage after the depth-5
    // multiplier — more than a full health bar from one volley, which is why
    // no run ever got past this fight.
    name: 'Corridor Warden', hp: 345, speed: 1.9, radius: 0.62, height: 1.9, z: 0.95,
    melee: { dmg: 18, reach: 1.9, cd: 1.6, windup: 0.5, knock: 9 },
    ranged: { dmg: 11, speed: 8, cd: 3.2, range: 16, windup: 0.7, burst: 3, spread: 0.42, color: [255, 90, 120] },
    aggro: 30, sprite: 'warden', mass: 8, boss: true,
  },
  // Deep-floor variant: a blinking caster that refuses to be cornered.
  wardenVeil: {
    name: 'Warden of the Veil', hp: 350, speed: 2.1, radius: 0.58, height: 1.85, z: 0.95,
    ranged: { dmg: 10, speed: 7, cd: 2.4, range: 17, windup: 0.6, burst: 3, spread: 0.2, homing: 1.3, color: [190, 130, 255] },
    keepAway: 6, teleport: 5, aggro: 30, sprite: 'warden', mass: 6, boss: true,
    tintBase: [205, 160, 255],
  },
};

// Elite modifiers rolled by the level generator on deeper floors. An elite is
// visibly bigger and tinted, always drops a pickup, and carries one twist.
export const ELITES = {
  swift:     { name: 'Swift',     tint: [190, 255, 150], hp: 0.9, dmg: 1.25, speed: 1.45 },
  stoneskin: { name: 'Stoneskin', tint: [185, 185, 210], hp: 2.2, dmg: 1.1, mass: 3 },
  vampiric:  { name: 'Vampiric',  tint: [255, 130, 160], hp: 1.4, dmg: 1.2, leech: 0.6 },
  volatile:  { name: 'Volatile',  tint: [255, 180, 100], hp: 1.2, dmg: 1.15, explode: true },
};

export const ELITE_IDS = Object.keys(ELITES);

export function scaledStats(typeId, depth) {
  const t = ENEMY_TYPES[typeId];
  const hpMul = 1 + 0.18 * (depth - 1);
  const dmgMul = 1 + 0.1 * (depth - 1);
  return { ...t, maxHp: Math.round(t.hp * hpMul), dmgMul };
}

let nextId = 1;

export class Enemy {
  constructor(typeId, x, y, depth, eliteId = null, roll = Math.random) {
    const s = scaledStats(typeId, depth);
    // Every roll that can change the outcome of a fight comes from the run's
    // seeded stream, so a seeded run replays identically. Cosmetic randomness
    // (embers, sparks) stays on Math.random and cannot perturb the simulation.
    this.roll = roll;
    this.id = nextId++;
    this.typeId = typeId;
    this.type = s;
    this.name = s.name;
    this.elite = eliteId ? ELITES[eliteId] : null;
    if (this.elite) {
      const e = this.elite;
      s.maxHp = Math.round(s.maxHp * e.hp);
      s.dmgMul *= e.dmg;
      if (e.speed) s.speed *= e.speed;
      if (e.mass) s.mass *= e.mass;
      this.name = `${e.name} ${s.name}`;
      s.height *= 1.15;
    }
    this.x = x; this.y = y;
    this.z = s.z;
    this.radius = s.radius;
    this.height = s.height;
    this.hp = s.maxHp;
    this.maxHp = s.maxHp;
    this.hpBarTime = 0;
    this.dead = false;
    this.awake = false;
    this.vx = 0; this.vy = 0;          // knockback velocity, decays fast
    this.attackTimer = 0;
    this.readyIn = 0;        // brief hold after spawning so packs arrive in waves
    this.windup = 0;
    this.windupKind = null;
    this.burstLeft = 0;
    this.burstTimer = 0;
    this.stun = 0;
    this.hitFlash = 0;
    this.strafe = roll() < 0.5 ? 1 : -1;
    this.strafeTimer = 0;
    this.bob = roll() * 6.28;
    this.teleportCd = 3;
    this.effects = { burn: 0, burnDps: 0, poison: 0, poisonDps: 0, chill: 0, chillSlow: 0, shock: 0, shockAmp: 0 };
    this.encounter = null;
  }

  get alive() { return !this.dead; }

  applyStatus(spell) {
    const e = this.effects;
    if (spell.burn) { e.burn = Math.max(e.burn, spell.burn.time); e.burnDps = Math.max(e.burnDps, spell.burn.dps); }
    if (spell.poison) { e.poison = Math.max(e.poison, spell.poison.time); e.poisonDps = Math.max(e.poisonDps, spell.poison.dps); }
    if (spell.chill) { e.chill = Math.max(e.chill, spell.chill.time); e.chillSlow = Math.max(e.chillSlow, spell.chill.slow); }
    if (spell.shock) { e.shock = Math.max(e.shock, spell.shock.time); e.shockAmp = Math.max(e.shockAmp, spell.shock.amp); }
    if (spell.stun) this.stun = Math.max(this.stun, spell.stun);
  }

  damage(amount, game, opts = {}) {
    if (this.dead) return 0;
    let amp = this.effects.shock > 0 ? 1 + this.effects.shockAmp : 1;
    // Conflagrate: rot fuels fire — a target both burning and poisoned takes
    // a quarter more from everything.
    if (this.effects.burn > 0 && this.effects.poison > 0) {
      amp *= 1.25;
      game.synergyHint?.('conflagrate');
    }
    let dealt = amount * amp;
    // Shatter: a heavy blow on a chilled target consumes the chill for +50%.
    if (this.effects.chill > 0 && dealt >= 22) {
      dealt *= 1.5;
      this.effects.chill = 0;
      this.effects.chillSlow = 0;
      game.spawnHitBurst(this.x, this.y, this.z, [180, 230, 255], 12);
      game.audio?.play('shatter', { x: this.x, y: this.y });
      game.synergyHint?.('shatter');
    }
    this.hp -= dealt;
    this.hitFlash = 0.09;
    this.hpBarTime = 1.7;
    this.awake = true;
    if (this.encounter && !this.encounter.triggered) game.triggerEncounter(this.encounter);
    if (!opts.silent) {
      game.spawnHitBurst(this.x, this.y, this.z, opts.color || [255, 220, 180], 5);
      game.addDamageNumber(this, dealt, opts.color);
      game.hitMarker = 0.14;
    }
    if (this.hp <= 0) this.kill(game);
    return dealt;
  }

  knockback(dx, dy, force) {
    const m = Math.max(0.4, this.type.mass);
    const len = Math.hypot(dx, dy) || 1;
    this.vx += (dx / len) * (force / m);
    this.vy += (dy / len) * (force / m);
  }

  kill(game) {
    if (this.dead) return;
    this.dead = true;
    game.onEnemyDeath(this);
  }

  update(dt, game) {
    if (this.dead) return;
    const p = game.player;
    const e = this.effects;

    // --- damage over time ---
    if (e.burn > 0) { e.burn -= dt; this.hp -= e.burnDps * dt; if (Math.random() < dt * 8) game.spawnEmber(this.x, this.y, this.z, [255, 140, 60]); }
    if (e.poison > 0) { e.poison -= dt; this.hp -= e.poisonDps * dt; if (Math.random() < dt * 6) game.spawnEmber(this.x, this.y, this.z, [150, 235, 90]); }
    if (e.chill > 0) e.chill -= dt; else e.chillSlow = 0;
    if (e.shock > 0) e.shock -= dt; else e.shockAmp = 0;
    if (this.hp <= 0) { this.kill(game); return; }
    if (this.hitFlash > 0) this.hitFlash -= dt;
    if (this.hpBarTime > 0) this.hpBarTime -= dt;

    // --- knockback slide ---
    if (Math.abs(this.vx) > 0.01 || Math.abs(this.vy) > 0.01) {
      this.move(this.vx * dt, this.vy * dt, game);
      const decay = Math.exp(-9 * dt);
      this.vx *= decay; this.vy *= decay;
    }

    if (this.stun > 0) { this.stun -= dt; this.bob += dt * 3; return; }

    if (this.readyIn > 0) { this.readyIn -= dt; this.bob += dt * 2; return; }

    const dx = p.x - this.x, dy = p.y - this.y;
    const dist = Math.hypot(dx, dy);
    const los = game.hasLineOfSight(this.x, this.y, p.x, p.y);
    if (!this.awake && dist < this.type.aggro && los) this.awake = true;
    if (!this.awake) return;

    this.bob += dt * (this.type.hover ? 2.2 : 6);
    this.attackTimer -= dt;
    this.teleportCd -= dt;
    this.strafeTimer -= dt;
    if (this.strafeTimer <= 0) { this.strafeTimer = 1 + this.roll() * 1.5; this.strafe = this.roll() < 0.5 ? 1 : -1; }

    // --- resolve a wind-up already in progress ---
    if (this.windup > 0) {
      this.windup -= dt;
      if (this.windup <= 0) this.release(game, dist, los);
      return;
    }
    if (this.burstLeft > 0) {
      this.burstTimer -= dt;
      if (this.burstTimer <= 0) {
        this.fire(game);
        this.burstLeft--;
        this.burstTimer = 0.13;
      }
      return;
    }

    const slow = 1 - e.chillSlow;
    const speed = this.type.speed * slow;
    const toward = dist > 0.001 ? { x: dx / dist, y: dy / dist } : { x: 1, y: 0 };

    // Melee first: an enemy that also shoots must not stand nose to nose
    // firing bolts that spawn behind its target.
    if (this.type.melee && dist < this.type.melee.reach + p.radius && this.attackTimer <= 0) {
      this.windup = this.type.melee.windup;
      this.windupKind = 'melee';
      return;
    }
    if (this.type.ranged && los && dist < this.type.ranged.range &&
        dist > (this.type.melee ? this.type.melee.reach * 0.8 : 0) && this.attackTimer <= 0) {
      this.windup = this.type.ranged.windup;
      this.windupKind = 'ranged';
      return;
    }

    // Warlocks reposition by blinking when crowded.
    if (this.type.teleport && this.teleportCd <= 0 && dist < 4 && los) {
      this.teleportCd = 6 + this.roll() * 3;
      game.blinkEnemy(this, -toward.x, -toward.y, this.type.teleport);
      return;
    }

    let mx = 0, my = 0;
    const keep = this.type.keepAway || 0;
    if (this.type.speed > 0) {
      if (keep && dist < keep * 0.85 && los) { mx -= toward.x; my -= toward.y; }
      else if (!keep || dist > keep || !los) { mx += toward.x; my += toward.y; }
      if (los && keep) { mx += -toward.y * this.strafe * 0.8; my += toward.x * this.strafe * 0.8; }
    }

    // Never share the player's space: overlapping makes the direction between
    // the two undefined, so neither side can aim at the other.
    const touch = this.radius + p.radius;
    if (dist < touch) {
      const push = dist > 0.001 ? { x: -toward.x, y: -toward.y } : { x: 1, y: 0 };
      mx += push.x * (1 - dist / touch) * 2.5;
      my += push.y * (1 - dist / touch) * 2.5;
    }

    // Push apart so packs do not fuse into one sprite.
    for (const other of game.enemies) {
      if (other === this || other.dead) continue;
      const ox = this.x - other.x, oy = this.y - other.y;
      const od = Math.hypot(ox, oy);
      const want = this.radius + other.radius;
      if (od > 0.001 && od < want) {
        mx += (ox / od) * (1 - od / want) * 1.6;
        my += (oy / od) * (1 - od / want) * 1.6;
      }
    }

    const ml = Math.hypot(mx, my);
    if (ml > 0.001) this.move((mx / ml) * speed * dt, (my / ml) * speed * dt, game);
  }

  release(game, dist, los) {
    const kind = this.windupKind;
    this.windupKind = null;
    if (kind === 'melee') {
      const m = this.type.melee;
      this.attackTimer = m.cd;
      const p = game.player;
      const d = Math.hypot(p.x - this.x, p.y - this.y);
      if (d < m.reach + p.radius + 0.35) {
        const dmg = m.dmg * this.type.dmgMul;
        game.damagePlayer(dmg, this);
        if (m.knock) game.shovePlayer(p.x - this.x, p.y - this.y, m.knock);
        // Vampiric elites drink from every landed blow.
        if (this.elite?.leech) {
          this.hp = Math.min(this.maxHp, this.hp + dmg * this.elite.leech);
          game.spawnEmber(this.x, this.y, this.z, [255, 90, 130]);
        }
      }
      game.spawnSwipe(this, game.player);
    } else if (kind === 'ranged') {
      const r = this.type.ranged;
      this.attackTimer = r.cd;
      if (r.burst) { this.burstLeft = r.burst; this.burstTimer = 0; }
      else this.fire(game);
    }
  }

  fire(game) {
    const r = this.type.ranged;
    const p = game.player;
    let ang = Math.atan2(p.y - this.y, p.x - this.x);
    if (r.spread) ang += (this.roll() - 0.5) * r.spread * 2;
    game.spawnEnemyProjectile(this, ang, r);
  }

  // Axis-separated so we slide along walls instead of sticking to them. Bulky
  // enemies are wider than a one-tile corridor, so when both axes are blocked
  // they squeeze: without this a Brute or the Warden can wedge itself in a
  // doorway and never reach the player again.
  move(dx, dy, game) {
    const level = game.level;
    const r = this.radius;
    const freeX = !collides(level, this.x + dx, this.y, r);
    const freeY = !collides(level, this.x, this.y + dy, r);
    if (freeX) this.x += dx;
    if (freeY) this.y += dy;
    if (freeX || freeY) return;
    const squeeze = Math.min(r, 0.34);
    if (!collides(level, this.x + dx, this.y, squeeze)) this.x += dx;
    if (!collides(level, this.x, this.y + dy, squeeze)) this.y += dy;
  }
}

export function collides(level, x, y, r) {
  for (const [ox, oy] of [[-r, -r], [r, -r], [-r, r], [r, r], [0, 0]]) {
    if (level.solid(Math.floor(x + ox), Math.floor(y + oy))) return true;
  }
  return false;
}

export { clamp, angleDelta };

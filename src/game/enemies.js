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
    name: 'Corridor Warden', hp: 460, speed: 1.9, radius: 0.62, height: 1.9, z: 0.95,
    melee: { dmg: 26, reach: 1.9, cd: 1.6, windup: 0.5, knock: 9 },
    ranged: { dmg: 16, speed: 8, cd: 3.2, range: 16, windup: 0.7, burst: 5, spread: 0.42, color: [255, 90, 120] },
    aggro: 30, sprite: 'warden', mass: 8, boss: true,
  },
};

export function scaledStats(typeId, depth) {
  const t = ENEMY_TYPES[typeId];
  const hpMul = 1 + 0.18 * (depth - 1);
  const dmgMul = 1 + 0.1 * (depth - 1);
  return { ...t, maxHp: Math.round(t.hp * hpMul), dmgMul };
}

let nextId = 1;

export class Enemy {
  constructor(typeId, x, y, depth) {
    const s = scaledStats(typeId, depth);
    this.id = nextId++;
    this.typeId = typeId;
    this.type = s;
    this.name = s.name;
    this.x = x; this.y = y;
    this.z = s.z;
    this.radius = s.radius;
    this.height = s.height;
    this.hp = s.maxHp;
    this.maxHp = s.maxHp;
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
    this.strafe = Math.random() < 0.5 ? 1 : -1;
    this.strafeTimer = 0;
    this.bob = Math.random() * 6.28;
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
    const amp = this.effects.shock > 0 ? 1 + this.effects.shockAmp : 1;
    const dealt = amount * amp;
    this.hp -= dealt;
    this.hitFlash = 0.09;
    this.awake = true;
    if (this.encounter && !this.encounter.triggered) game.triggerEncounter(this.encounter);
    if (!opts.silent) game.spawnHitBurst(this.x, this.y, this.z, opts.color || [255, 220, 180], 5);
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
    if (this.strafeTimer <= 0) { this.strafeTimer = 1 + Math.random() * 1.5; this.strafe = Math.random() < 0.5 ? 1 : -1; }

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
      this.teleportCd = 6 + Math.random() * 3;
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
        game.damagePlayer(m.dmg * this.type.dmgMul, this);
        if (m.knock) game.shovePlayer(p.x - this.x, p.y - this.y, m.knock);
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
    if (r.spread) ang += (Math.random() - 0.5) * r.spread * 2;
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

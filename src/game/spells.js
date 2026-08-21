// Spell data. Pure numbers and metadata — casting lives in game.js so this
// module stays testable outside a browser.
//
// kinds: bolt (travelling projectile) | beam (instant line) | nova (ring around
// the caster) | cone (forward wedge) | self (buff, heal or blink)

export const SCHOOLS = {
  fire:   { name: 'Fire',   color: [255, 128, 48] },
  frost:  { name: 'Frost',  color: [110, 200, 255] },
  storm:  { name: 'Storm',  color: [180, 160, 255] },
  arcane: { name: 'Arcane', color: [120, 255, 220] },
  rot:    { name: 'Rot',    color: [150, 235, 90] },
};

export const SPELLS = {
  emberBolt: {
    id: 'emberBolt', name: 'Ember Bolt', school: 'fire', tier: 1, glyph: '✦',
    kind: 'bolt', cost: 7, cd: 0.34, dmg: 15, speed: 15, radius: 0.22,
    burn: { dps: 6, time: 2.5 },
    desc: 'A quick cinder that sets its mark alight.',
  },
  fireball: {
    id: 'fireball', name: 'Fireball', school: 'fire', tier: 2, glyph: '☀',
    kind: 'bolt', cost: 26, cd: 1.1, dmg: 34, speed: 11, radius: 0.34,
    blast: 2.3, blastDmg: 26, burn: { dps: 9, time: 3 }, knock: 4,
    desc: 'Detonates on impact, scorching everything nearby.',
  },
  flameWave: {
    id: 'flameWave', name: 'Flame Wave', school: 'fire', tier: 2, glyph: '≋',
    kind: 'cone', cost: 22, cd: 1.4, dmg: 30, range: 5.5, arc: 0.75,
    burn: { dps: 12, time: 3.5 }, knock: 2,
    desc: 'A sheet of fire that washes down the corridor.',
  },
  frostShard: {
    id: 'frostShard', name: 'Frost Shard', school: 'frost', tier: 1, glyph: '❖',
    kind: 'bolt', cost: 6, cd: 0.32, dmg: 12, speed: 17, radius: 0.2,
    chill: { slow: 0.45, time: 2.5 },
    desc: 'Splinter of black ice. Numbs whatever it strikes.',
  },
  iceLance: {
    id: 'iceLance', name: 'Ice Lance', school: 'frost', tier: 2, glyph: '↟',
    kind: 'bolt', cost: 20, cd: 0.85, dmg: 40, speed: 22, radius: 0.24, pierce: 3,
    chill: { slow: 0.35, time: 2 },
    desc: 'Skewers a whole rank of enemies in one throw.',
  },
  glacialNova: {
    id: 'glacialNova', name: 'Glacial Nova', school: 'frost', tier: 3, glyph: '❉',
    kind: 'nova', cost: 30, cd: 3.4, dmg: 26, range: 4.6,
    chill: { slow: 0.7, time: 4 }, knock: 5,
    desc: 'A ring of killing cold. Buys room when they close in.',
  },
  arcBolt: {
    id: 'arcBolt', name: 'Arc Bolt', school: 'storm', tier: 1, glyph: '⚡',
    kind: 'bolt', cost: 5, cd: 0.2, dmg: 9, speed: 26, radius: 0.16,
    shock: { amp: 0.25, time: 3 },
    desc: 'Cheap, fast, relentless. Leaves the target conductive.',
  },
  chainLightning: {
    id: 'chainLightning', name: 'Chain Lightning', school: 'storm', tier: 2, glyph: '⑂',
    kind: 'beam', cost: 24, cd: 1.15, dmg: 32, range: 14, chains: 3, chainRange: 5, chainFalloff: 0.72,
    shock: { amp: 0.3, time: 3 },
    desc: 'Leaps from body to body, weakening with every jump.',
  },
  thunderclap: {
    id: 'thunderclap', name: 'Thunderclap', school: 'storm', tier: 3, glyph: '◎',
    kind: 'nova', cost: 26, cd: 3, dmg: 30, range: 3.8, stun: 1.1, knock: 6,
    desc: 'Concussive blast that leaves the ring around you reeling.',
  },
  arcaneMissile: {
    id: 'arcaneMissile', name: 'Arcane Missile', school: 'arcane', tier: 1, glyph: '➶',
    kind: 'bolt', cost: 11, cd: 0.5, dmg: 21, speed: 13, radius: 0.22, homing: 3.2,
    desc: 'Hunts its target around corners. Never wasted.',
  },
  forceWave: {
    id: 'forceWave', name: 'Force Wave', school: 'arcane', tier: 2, glyph: '»',
    kind: 'cone', cost: 14, cd: 1.5, dmg: 12, range: 5, arc: 0.9, knock: 11,
    desc: 'Little damage, enormous shove. Makes space.',
  },
  manaSiphon: {
    id: 'manaSiphon', name: 'Mana Siphon', school: 'arcane', tier: 2, glyph: '∿',
    kind: 'beam', cost: 0, cd: 0.55, dmg: 11, range: 10, manaGain: 9,
    desc: 'Costs nothing and gives back. Your fallback when dry.',
  },
  blink: {
    id: 'blink', name: 'Blink', school: 'arcane', tier: 2, glyph: '⇄',
    kind: 'self', cost: 16, cd: 3.5, effect: 'blink', distance: 4,
    desc: 'Step through the intervening space. Ignores nothing solid.',
  },
  arcaneWard: {
    id: 'arcaneWard', name: 'Arcane Ward', school: 'arcane', tier: 2, glyph: '⌾',
    kind: 'self', cost: 30, cd: 8, effect: 'shield', shield: 55, time: 9,
    desc: 'A shell that soaks damage before your flesh does.',
  },
  mendingLight: {
    id: 'mendingLight', name: 'Mending Light', school: 'arcane', tier: 3, glyph: '✚',
    kind: 'self', cost: 34, cd: 11, effect: 'heal', heal: 42,
    desc: 'Knits you back together. Slow to come around again.',
  },
  rotBolt: {
    id: 'rotBolt', name: 'Rot Bolt', school: 'rot', tier: 1, glyph: '☣',
    kind: 'bolt', cost: 9, cd: 0.45, dmg: 9, speed: 13, radius: 0.24,
    poison: { dps: 9, time: 5 },
    desc: 'Weak on impact. The rot does the real work.',
  },
  soulReap: {
    id: 'soulReap', name: 'Soul Reap', school: 'rot', tier: 2, glyph: '⌇',
    kind: 'cone', cost: 16, cd: 1, dmg: 26, range: 3.4, arc: 1.1, leech: 0.3,
    desc: 'A close scything cut that feeds you what it takes.',
  },
  voidWell: {
    id: 'voidWell', name: 'Void Well', school: 'rot', tier: 3, glyph: '◍',
    kind: 'bolt', cost: 24, cd: 3.2, dmg: 16, speed: 8, radius: 0.3,
    blast: 3.2, blastDmg: 14, pull: 9, chill: { slow: 0.3, time: 2 },
    desc: 'Collapses into a knot of gravity and drags them in.',
  },
  witherTouch: {
    id: 'witherTouch', name: 'Wither Touch', school: 'rot', tier: 3, glyph: '☠',
    kind: 'beam', cost: 20, cd: 1.3, dmg: 30, range: 8, leech: 0.4,
    poison: { dps: 11, time: 4 },
    desc: 'A long draining thread. Trades their years for yours.',
  },
};

export const SPELL_IDS = Object.keys(SPELLS);

export const MAX_RANK = 3;

/** Effective numbers for a spell at a given rank, with caster modifiers applied. */
// --- reactions ------------------------------------------------------------
//
// The three cross-school reactions, described in one place so the cards that
// advertise them, the log line that names them and the code that fires them
// cannot drift apart. `needs` are tags produced by spellProvides below.

export const SHATTER_MIN = 22;   // a single blow this large breaks a chilled target

export const SYNERGIES = {
  conflagrate: {
    name: 'Conflagrate',
    needs: ['burn', 'poison'],
    hint: 'Conflagrate! Rot fuels fire for bonus damage',
    blurb: 'burning and rotting at once takes a quarter more from everything',
  },
  shatter: {
    name: 'Shatter',
    needs: ['chill', 'heavy'],
    hint: 'Shatter! Heavy blows break chilled foes',
    blurb: 'a heavy blow on a chilled foe lands for half again',
  },
  conduction: {
    name: 'Conduction',
    needs: ['shock'],
    hint: 'Conduction! Shock arcs onward when its host dies',
    blurb: 'shock jumps to the next foe when its host dies',
  },
};

/**
 * What a spell contributes toward a reaction, at the rank it would be held at.
 * "heavy" uses the largest single hit it can land — a blast that clips a target
 * at the edge of its radius falls off and may not reach the threshold.
 */
export function spellProvides(spellId, rank = 1, mods = {}) {
  const s = spellStats(spellId, rank, mods);
  const tags = [];
  if (s.burn) tags.push('burn');
  if (s.poison) tags.push('poison');
  if (s.chill) tags.push('chill');
  if (s.shock) tags.push('shock');
  if (Math.max(s.dmg || 0, s.blastDmg || 0) >= SHATTER_MIN) tags.push('heavy');
  return tags;
}

/** Every tag a loadout can currently put on a target. */
export function loadoutTags(slots, mods = {}) {
  const tags = new Set();
  for (const entry of slots) {
    if (!entry) continue;
    for (const tag of spellProvides(entry.id, entry.rank, mods)) tags.add(tag);
  }
  return tags;
}

/** Which reactions a loadout can already produce. */
export function activeSynergies(slots, mods = {}) {
  const tags = loadoutTags(slots, mods);
  return Object.keys(SYNERGIES).filter((k) => SYNERGIES[k].needs.every((n) => tags.has(n)));
}

/**
 * The reaction a spell would newly unlock, and which held spell completes it.
 * Returns null when it adds nothing the loadout could not already do.
 */
export function synergyUnlockedBy(slots, spellId, rank, mods = {}) {
  const already = new Set(activeSynergies(slots, mods));
  const have = loadoutTags(slots, mods);
  const adding = spellProvides(spellId, rank, mods);
  const after = new Set([...have, ...adding]);

  for (const [key, syn] of Object.entries(SYNERGIES)) {
    if (already.has(key)) continue;
    if (!syn.needs.every((n) => after.has(n))) continue;
    // Name the spell already held that this one pairs with, so the card can say
    // what it combines with rather than just naming a mechanic.
    const missing = syn.needs.filter((n) => !adding.includes(n));
    let partner = null;
    for (const entry of slots) {
      if (!entry || entry.id === spellId) continue;
      const provides = spellProvides(entry.id, entry.rank, mods);
      if (missing.some((n) => provides.includes(n))) { partner = SPELLS[entry.id].name; break; }
    }
    return { key, name: syn.name, blurb: syn.blurb, partner };
  }
  return null;
}

export function spellStats(spellId, rank = 1, mods = {}) {
  const base = SPELLS[spellId];
  const power = 1 + 0.35 * (rank - 1);
  const thrift = Math.pow(0.88, rank - 1);
  const schoolMul = (mods.schoolBonus && mods.schoolBonus[base.school]) || 1;
  const dmgMul = (mods.dmgMul || 1) * schoolMul * power;
  const s = {
    ...base,
    rank,
    cost: Math.round(base.cost * thrift * (mods.costMul || 1)),
    cd: +(base.cd * (mods.cdMul || 1)).toFixed(3),
    dmg: Math.round((base.dmg || 0) * dmgMul),
  };
  if (base.blastDmg) s.blastDmg = Math.round(base.blastDmg * dmgMul);
  if (base.heal) s.heal = Math.round(base.heal * power);
  if (base.shield) s.shield = Math.round(base.shield * power);
  if (base.burn) s.burn = { dps: +(base.burn.dps * dmgMul).toFixed(2), time: base.burn.time };
  if (base.poison) s.poison = { dps: +(base.poison.dps * dmgMul).toFixed(2), time: base.poison.time };
  if (base.chill) s.chill = { slow: Math.min(0.85, base.chill.slow * (1 + 0.1 * (rank - 1)) * (mods.chillMul || 1)), time: base.chill.time };
  if (base.shock) s.shock = { amp: base.shock.amp * (1 + 0.15 * (rank - 1)), time: base.shock.time };
  if (base.chains) s.chains = base.chains + (rank - 1);
  if (base.pierce) s.pierce = base.pierce + (rank - 1);
  return s;
}

export function schoolColor(spellId) {
  return SCHOOLS[SPELLS[spellId].school].color;
}

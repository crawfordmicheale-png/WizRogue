import { SPELLS, SPELL_IDS, MAX_RANK, SCHOOLS, spellStats } from './spells.js';

// Builds the three cards offered after each cleared depth. Options are drawn so
// that a run keeps improving even when the spell pool runs dry.
export function rollRewards(game, rngFloat = Math.random) {
  const p = game.player;
  const depth = game.depth;
  const pool = [];

  const owned = p.slots.filter(Boolean).map((s) => s.id);
  const unowned = SPELL_IDS.filter((id) => !owned.includes(id));
  const affordableTier = depth < 3 ? 2 : 3;
  const candidates = unowned.filter((id) => SPELLS[id].tier <= affordableTier);
  const hasFreeSlot = p.slots.slice(0, p.unlocked).some((s) => !s);

  for (const id of pickSome(candidates, 3, rngFloat)) {
    const sp = SPELLS[id];
    pool.push({
      type: 'spell',
      spellId: id,
      weight: hasFreeSlot ? 32 : 18,
      title: sp.name,
      kicker: hasFreeSlot ? 'New spell' : 'New spell — replaces a slot',
      body: sp.desc,
      color: SCHOOLS[sp.school].color,
      glyph: sp.glyph,
      needsSlot: !hasFreeSlot,
    });
  }

  for (const entry of p.slots.filter((s) => s && s.rank < MAX_RANK)) {
    const sp = SPELLS[entry.id];
    const now = spellStats(entry.id, entry.rank, p.mods);
    const next = spellStats(entry.id, entry.rank + 1, p.mods);
    pool.push({
      type: 'empower',
      spellId: entry.id,
      weight: 22,
      title: `${sp.name} — rank ${entry.rank + 1}`,
      kicker: 'Empower',
      body: `${now.dmg || now.heal || now.shield} → ${next.dmg || next.heal || next.shield} power, ${now.cost} → ${next.cost} mana.`,
      color: SCHOOLS[sp.school].color,
      glyph: sp.glyph,
    });
  }

  pool.push(
    { type: 'health', amount: 22, weight: 16, title: 'Bulwark', kicker: 'Vitality', body: '+22 maximum vitality, healed for the same.', color: [255, 106, 134], glyph: '♥' },
    { type: 'mana', amount: 26, weight: 16, title: 'Deep Well', kicker: 'Mana', body: '+26 maximum mana, restored immediately.', color: [110, 200, 255], glyph: '◈' },
    { type: 'regen', amount: 2.2, weight: 14, title: 'Attunement', kicker: 'Regeneration', body: '+2.2 mana every second, forever.', color: [140, 220, 255], glyph: '∞' },
    { type: 'power', amount: 1.12, weight: 13, title: 'Focus', kicker: 'Power', body: 'All spells deal 12% more damage.', color: [255, 200, 120], glyph: '✧' },
    { type: 'haste', amount: 0.9, weight: 13, title: 'Quickened', kicker: 'Haste', body: 'All cooldowns are 10% shorter.', color: [200, 180, 255], glyph: '⧗' },
    { type: 'speed', amount: 0.07, weight: 11, title: 'Swiftness', kicker: 'Movement', body: 'You move 7% faster.', color: [150, 255, 200], glyph: '➤' },
  );
  if (p.health < p.maxHealth * 0.6) {
    pool.push({ type: 'restore', weight: 20, title: 'Respite', kicker: 'Recovery', body: 'Vitality and mana fully restored.', color: [180, 255, 200], glyph: '✚' });
  }

  return drawDistinct(pool, 3, rngFloat);
}

function pickSome(arr, n, rngFloat) {
  const copy = arr.slice();
  const out = [];
  while (copy.length && out.length < n) out.push(copy.splice(Math.floor(rngFloat() * copy.length), 1)[0]);
  return out;
}

function drawDistinct(pool, n, rngFloat) {
  const out = [];
  const left = pool.slice();
  while (out.length < n && left.length) {
    let total = 0;
    for (const e of left) total += e.weight;
    let r = rngFloat() * total;
    let idx = left.length - 1;
    for (let i = 0; i < left.length; i++) {
      r -= left[i].weight;
      if (r <= 0) { idx = i; break; }
    }
    const chosen = left.splice(idx, 1)[0];
    // Never offer two cards that touch the same spell.
    for (let i = left.length - 1; i >= 0; i--) {
      if (chosen.spellId && left[i].spellId === chosen.spellId) left.splice(i, 1);
    }
    out.push(chosen);
  }
  return out;
}

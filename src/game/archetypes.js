// Starting kits. Each one is a different opening hand and a different set of
// dials on the same underlying caster.
export const ARCHETYPES = [
  {
    id: 'pyromancer',
    name: 'Pyromancer',
    tagline: 'Burn it down',
    blurb: 'Highest raw damage, and everything you touch keeps burning. Fragile if you let them close.',
    spells: ['emberBolt', 'fireball'],
    stats: { health: 95, mana: 105, regen: 10.5, speed: 1, cdMul: 1, schoolBonus: { fire: 1.18 } },
    accent: '#ff8a3c',
  },
  {
    id: 'cryomancer',
    name: 'Cryomancer',
    tagline: 'Nothing reaches you',
    blurb: 'Deep mana and heavy slows. You win by making sure the corridor never arrives.',
    spells: ['frostShard', 'iceLance'],
    stats: { health: 100, mana: 130, regen: 10, speed: 1, cdMul: 1, chillMul: 1.25, schoolBonus: { frost: 1.1 } },
    accent: '#6ec8ff',
  },
  {
    id: 'stormcaller',
    name: 'Stormcaller',
    tagline: 'Faster than they are',
    blurb: 'Quick feet and short cooldowns. Small hits, delivered constantly, from moving ground.',
    spells: ['arcBolt', 'chainLightning'],
    stats: { health: 90, mana: 110, regen: 10.5, speed: 1.14, cdMul: 0.86, schoolBonus: { storm: 1.08 } },
    accent: '#b4a0ff',
  },
  {
    id: 'plaguebinder',
    name: 'Plaguebinder',
    tagline: 'Outlast the dark',
    blurb: 'Tough, and you drink what you kill. Damage arrives late but it never stops arriving.',
    spells: ['rotBolt', 'soulReap'],
    stats: { health: 135, mana: 85, regen: 8, speed: 0.96, cdMul: 1, leechBonus: 0.05, schoolBonus: { rot: 1.15 } },
    accent: '#96eb5a',
  },
  {
    id: 'arcanist',
    name: 'Arcanist',
    tagline: 'Never out of answers',
    blurb: 'Enormous regeneration and a ward to hide behind. The flexible pick, strong at any depth.',
    spells: ['arcaneMissile', 'arcaneWard'],
    stats: { health: 100, mana: 125, regen: 13, speed: 1.03, cdMul: 0.95, schoolBonus: { arcane: 1.1 } },
    accent: '#78ffdc',
  },
];

export const getArchetype = (id) => ARCHETYPES.find((a) => a.id === id) || ARCHETYPES[0];

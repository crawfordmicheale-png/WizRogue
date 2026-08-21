// Global tuning knobs. One world unit == one map tile == roughly 1.6 meters.
export const RENDER = {
  height: 270,          // internal vertical resolution; width follows the window aspect
  minWidth: 320,
  maxWidth: 760,
  fov: Math.PI / 3,     // horizontal FOV at 16:9
  viewDistance: 26,     // fog cutoff in tiles
  fog: [10, 9, 20],
};

// Every five depths the corridor changes character: a per-channel light tint
// over the whole scene plus its own fog colour. Cheap (the renderer already
// multiplies each channel by the light term) but reads as a new region.
export const BIOMES = [
  { name: 'the Catacombs',    tint: [1, 1, 1],          fog: [10, 9, 20] },
  { name: 'the Rust Vaults',  tint: [1.18, 0.94, 0.74], fog: [24, 12, 7] },
  { name: 'the Frozen Reach', tint: [0.8, 0.98, 1.24],  fog: [7, 13, 26] },
  { name: 'the Living Rot',   tint: [0.84, 1.12, 0.8],  fog: [9, 18, 9] },
  { name: 'the Void Beneath', tint: [1.02, 0.8, 1.22],  fog: [16, 6, 24] },
];

export function biomeForDepth(depth) {
  return BIOMES[Math.floor((depth - 1) / 5) % BIOMES.length];
}

export const PLAYER = {
  radius: 0.26,
  eye: 0.55,
  speed: 3.5,
  sprintMul: 1.5,
  accel: 16,
  friction: 12,
  mouseSens: 0.0022,
  pitchLimit: 0.55,     // as a fraction of screen height
  baseHealth: 100,
  baseMana: 100,
  baseRegen: 7.5,       // mana per second
  invulnAfterHit: 0.35,
};

// Loadout slots unlock as you descend; five is the cap. These sat at 3/5/7,
// which put the fourth and fifth slots at or past the depth most runs ended on —
// so the five-spell loadout the game is built around was never actually seen.
export const SLOT_UNLOCK_DEPTH = [1, 1, 2, 4, 6];

export const MAP = {
  size: 96,
  minNodes: 5,
  maxNodes: 11,
};

// Difficulty dials. A sealed room's budget is per-wave rather than per-room,
// because the wave count is the depth: a flat room budget spread over ten waves
// leaves each one holding less than a single enemy. Since the body count now
// climbs with depth, per-enemy scaling is gentler than it was — deep floors
// throw more at you rather than spongier versions of the same thing.
export const COMBAT = {
  waveBudget: 3.4,        // enemy-cost budget per wave
  waveBudgetPerDepth: 0.1,
  hpPerDepth: 0.06,
  dmgPerDepth: 0.05,
};

export function slotsForDepth(depth) {
  let n = 0;
  for (const d of SLOT_UNLOCK_DEPTH) if (depth >= d) n++;
  return n;
}

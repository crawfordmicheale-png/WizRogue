// Global tuning knobs. One world unit == one map tile == roughly 1.6 meters.
export const RENDER = {
  height: 270,          // internal vertical resolution; width follows the window aspect
  minWidth: 320,
  maxWidth: 760,
  fov: Math.PI / 3,     // horizontal FOV at 16:9
  viewDistance: 26,     // fog cutoff in tiles
  fog: [10, 9, 20],
};

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

// Loadout slots unlock as you descend; five is the cap.
export const SLOT_UNLOCK_DEPTH = [1, 1, 3, 5, 7];

export const MAP = {
  size: 96,
  minNodes: 5,
  maxNodes: 11,
};

export function slotsForDepth(depth) {
  let n = 0;
  for (const d of SLOT_UNLOCK_DEPTH) if (depth >= d) n++;
  return n;
}

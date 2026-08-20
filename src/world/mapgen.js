import { makeRng } from '../util/rng.js';
import { MAP } from '../config.js';
import { ELITE_IDS } from '../game/enemies.js';

export const T = {
  FLOOR: 0,
  STONE: 1,
  BRICK: 2,
  RUNE: 3,
  BARRIER: 4,   // arena seal: solid only while its encounter is live
};

const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];

// Enemy roster with a spawn cost, used to fill each arena's budget.
const ROSTER = [
  { id: 'crawler',  cost: 1, minDepth: 1, weight: 10 },
  { id: 'wisp',     cost: 2, minDepth: 1, weight: 7 },
  { id: 'brute',    cost: 4, minDepth: 2, weight: 5 },
  { id: 'sentinel', cost: 3, minDepth: 3, weight: 5 },
  { id: 'warlock',  cost: 6, minDepth: 4, weight: 4 },
];

/**
 * Builds one descent level: a single unbranching chain of corridors, junctions
 * and sealed arenas, ending at the portal down to the next depth.
 *
 * Layout rules keep the chain from touching itself (see `free` below), but the
 * geometry has enough corner cases that "probably linear" is not good enough —
 * a single loop would let the player walk around a sealed arena. So the result
 * is verified: every arena's pair of seals must be a genuine cut in the floor
 * graph. A level that fails is discarded and regenerated from a shifted seed;
 * in practice the first attempt passes about 97% of the time.
 */
export function generateLevel(seed, depth) {
  let last = null;
  for (let attempt = 0; attempt < 12; attempt++) {
    last = buildLevel((seed + attempt * 0x9e3779b9) >>> 0, depth);
    if (verifyLevel(last, depth)) return last;
  }
  // Nothing plausible got here (0.03^12), but never ship a level whose seals
  // can be walked around: drop the seals instead and leave the fight optional.
  return stripSeals(last);
}

function buildLevel(seed, depth) {
  const rng = makeRng(seed);
  const W = MAP.size, H = MAP.size;
  const tiles = new Uint8Array(W * H).fill(T.STONE);
  // floorId records which node first carved each cell and is never overwritten.
  // A node may only touch cells belonging to the node before it; anything older
  // means the corridor has looped back and would open a second route.
  const floorId = new Int32Array(W * H).fill(-1);
  const idx = (x, y) => y * W + x;
  const inBounds = (x, y) => x >= 3 && y >= 3 && x < W - 3 && y < H - 3;

  const spine = [];        // centre-line cells in walk order
  const encounters = [];
  const props = [];
  const barriers = new Map();
  let node = 0;

  function claim(x, y) {
    if (!inBounds(x, y)) return;
    const i = idx(x, y);
    if (floorId[i] < 0) floorId[i] = node;
  }

  function carve(x0, y0, x1, y1) {
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (!inBounds(x, y)) continue;
        if (tiles[idx(x, y)] !== T.BARRIER) tiles[idx(x, y)] = T.FLOOR;
        claim(x, y);
      }
    }
  }

  // Walkable cells are checked one ring wider than the rect: new floor may not
  // even sit beside existing floor, since a shared edge fuses two stretches of
  // corridor into a loop. The only exception is the two-cell neighbourhood of
  // the cursor, which is precisely where this carve is meant to join on.
  function free(x0, y0, x1, y1, cx, cy) {
    if (!inBounds(x0, y0) || !inBounds(x1, y1)) return false;
    for (let y = y0 - 1; y <= y1 + 1; y++) {
      for (let x = x0 - 1; x <= x1 + 1; x++) {
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        if (floorId[idx(x, y)] < 0) continue;
        if (Math.abs(x - cx) <= 2 && Math.abs(y - cy) <= 2) continue;
        return false;
      }
    }
    return true;
  }

  function corridorRect(x, y, d, len, wid) {
    const [dx, dy] = DIRS[d];
    const hw = (wid - 1) >> 1;
    const ex = x + dx * len, ey = y + dy * len;
    const px = Math.abs(dy), py = Math.abs(dx);
    return {
      x0: Math.min(x, ex) - hw * px, x1: Math.max(x, ex) + hw * px,
      y0: Math.min(y, ey) - hw * py, y1: Math.max(y, ey) + hw * py,
      ex, ey,
    };
  }

  function pushSpine(x, y, d, len) {
    const [dx, dy] = DIRS[d];
    for (let i = 1; i <= len; i++) spine.push({ x: x + dx * i, y: y + dy * i });
  }

  // --- starting alcove ----------------------------------------------------
  let x = W >> 1, y = H >> 1, dir = rng.int(0, 3);
  carve(x - 2, y - 2, x + 2, y + 2);
  spine.push({ x, y });
  const spawn = { x: x + 0.5, y: y + 0.5, dir: Math.atan2(DIRS[dir][1], DIRS[dir][0]) };

  const nodeCount = Math.min(MAP.maxNodes, MAP.minNodes + Math.floor(depth / 2) + rng.int(0, 2));

  for (let n = 0; n < nodeCount; n++) {
    node = n + 1;
    // Straight on where possible, otherwise a single 90 degree turn. We never
    // carve a second opening, so there is always exactly one way forward.
    const turn = rng.next();
    const headings = turn < 0.45 ? [dir, (dir + 1) % 4, (dir + 3) % 4]
      : turn < 0.72 ? [(dir + 1) % 4, dir, (dir + 3) % 4]
        : [(dir + 3) % 4, dir, (dir + 1) % 4];

    let moved = false;
    for (const nd of headings) {
      const len = rng.int(6, 13);
      const wid = rng.chance(0.18) ? 3 : 1;
      const r = corridorRect(x, y, nd, len, wid);
      if (!free(r.x0, r.y0, r.x1, r.y1, x, y)) continue;
      carve(r.x0, r.y0, r.x1, r.y1);
      pushSpine(x, y, nd, len);
      x = r.ex; y = r.ey; dir = nd; moved = true;
      break;
    }
    if (!moved) break;

    const wantArena = n % 2 === 1 || rng.chance(0.3);
    if (!(wantArena && tryArena())) {
      if (free(x - 1, y - 1, x + 1, y + 1, x, y)) carve(x - 1, y - 1, x + 1, y + 1);
    }
  }

  function tryArena() {
    const [dx, dy] = DIRS[dir];
    const len = rng.int(5, 8);
    const hw = rng.int(2, 4);
    const px = Math.abs(dy), py = Math.abs(dx);
    const ex = x + dx * len, ey = y + dy * len;
    const x0 = Math.min(x, ex) - hw * px, x1 = Math.max(x, ex) + hw * px;
    const y0 = Math.min(y, ey) - hw * py, y1 = Math.max(y, ey) + hw * py;

    // Test the hall together with the airlock neck punched out of the far side.
    const nx = ex + dx * 3, ny = ey + dy * 3;
    if (!free(Math.min(x0, nx), Math.min(y0, ny), Math.max(x1, nx), Math.max(y1, ny), x, y)) return false;

    const entry = { x: x - dx, y: y - dy };
    const exit = { x: ex + dx, y: ey + dy };
    if (!inBounds(entry.x, entry.y) || !inBounds(exit.x, exit.y)) return false;

    carve(x0, y0, x1, y1);
    pushSpine(x, y, dir, len);

    const id = encounters.length;
    const seals = [entry, exit];
    for (const c of seals) {
      tiles[idx(c.x, c.y)] = T.BARRIER;
      claim(c.x, c.y);   // a seal is walkable once it opens, so it counts as floor
      barriers.set(`${c.x},${c.y}`, { x: c.x, y: c.y, encounter: id, active: false, open: false });
    }
    // Two cells of neck past the exit seal keep the next corridor clear of the hall.
    carve(exit.x + dx, exit.y + dy, exit.x + dx, exit.y + dy);
    carve(nx, ny, nx, ny);
    spine.push({ x: exit.x, y: exit.y }, { x: exit.x + dx, y: exit.y + dy }, { x: nx, y: ny });

    encounters.push({
      id,
      kind: 'arena',
      bounds: { x0, y0, x1, y1 },
      center: { x: (x0 + x1) / 2 + 0.5, y: (y0 + y1) / 2 + 0.5 },
      seals,
      spawns: rollSpawns(rng, depth, { x0, y0, x1, y1 }, tiles, W, 3 + depth * 1.5),
      triggered: false,
      cleared: false,
    });

    x = nx; y = ny;
    return true;
  }

  // --- portal chamber -----------------------------------------------------
  const [fdx, fdy] = DIRS[dir];
  const entrance = { x: x - fdx, y: y - fdy };
  let portal = { x: x + 0.5, y: y + 0.5 };
  let chamber = null;
  node = nodeCount + 1;

  // Try progressively smaller halls so the descent always ends somewhere open;
  // a boss with no room to fight in is worse than a modest chamber.
  const shapes = depth % 5 === 0
    ? [[6, 3], [6, 2], [5, 2]]     // a boss needs room to be fought in
    : [[6, 3], [5, 3], [5, 2], [4, 2], [3, 1]];
  for (const [len, hw] of shapes) {
    const pr = {
      x0: Math.min(x, x + fdx * len) - hw * Math.abs(fdy),
      x1: Math.max(x, x + fdx * len) + hw * Math.abs(fdy),
      y0: Math.min(y, y + fdy * len) - hw * Math.abs(fdx),
      y1: Math.max(y, y + fdy * len) + hw * Math.abs(fdx),
    };
    if (!free(pr.x0, pr.y0, pr.x1, pr.y1, x, y)) continue;
    carve(pr.x0, pr.y0, pr.x1, pr.y1);
    pushSpine(x, y, dir, len);
    x += fdx * len; y += fdy * len;
    portal = { x: x + 0.5, y: y + 0.5 };
    chamber = pr;
    break;
  }

  if (chamber && depth % 5 === 0) {
    // Seal the doorway so the Warden cannot be walked away from — otherwise a
    // retreating player leaves the portal dormant with no way to finish.
    const id = encounters.length;
    const gateSeals = [];
    if (inBounds(entrance.x, entrance.y) && tiles[idx(entrance.x, entrance.y)] === T.FLOOR) {
      tiles[idx(entrance.x, entrance.y)] = T.BARRIER;
      barriers.set(`${entrance.x},${entrance.y}`, {
        x: entrance.x, y: entrance.y, encounter: id, active: false, open: false,
      });
      gateSeals.push(entrance);
    }
    encounters.push({
      id,
      kind: 'boss',
      bounds: chamber,
      center: { x: (chamber.x0 + chamber.x1) / 2 + 0.5, y: (chamber.y0 + chamber.y1) / 2 + 0.5 },
      seals: gateSeals,
      // From depth 10 the seed may swap in the Veil variant: a blinking caster
      // that fights the room rather than the doorway.
      spawns: [{
        id: depth >= 10 && rng.chance(0.5) ? 'wardenVeil' : 'warden',
        x: (chamber.x0 + chamber.x1) / 2 + 0.5,
        y: (chamber.y0 + chamber.y1) / 2 + 0.5,
      }],
      triggered: false,
      cleared: false,
    });
  }

  // --- dressing -----------------------------------------------------------
  decorateWalls(tiles, W, H);
  props.push(...placeTorches(tiles, W, H, spine, rng));
  props.push(...scatterPickups(tiles, W, spine, rng, depth));

  const wanderers = [];
  const strollCount = Math.min(6, 1 + Math.floor(depth / 2));
  const roamPool = ROSTER.filter((e) => e.minDepth <= depth && e.cost <= 3);
  for (let i = 0; i < strollCount; i++) {
    const cell = spine[Math.floor((0.3 + 0.65 * (i / strollCount)) * spine.length)];
    if (!cell || tiles[idx(cell.x, cell.y)] !== T.FLOOR) continue;
    wanderers.push({ id: rng.weighted(roamPool).id, x: cell.x + 0.5, y: cell.y + 0.5 });
  }

  // Face the player down the corridor rather than at whichever wall the first
  // heading happened to pick.
  const facing = spine[Math.min(4, spine.length - 1)];
  if (facing) spawn.dir = Math.atan2(facing.y + 0.5 - spawn.y, facing.x + 0.5 - spawn.x);

  const light = buildLightmap(tiles, W, H, props, portal);

  return {
    w: W, h: H, tiles, light, spawn, portal, encounters, props, barriers, wanderers,
    depth, seed, spine,
    solid(cx, cy) {
      if (cx < 0 || cy < 0 || cx >= W || cy >= H) return true;
      const t = tiles[cy * W + cx];
      if (t === T.BARRIER) {
        const b = barriers.get(`${cx},${cy}`);
        return b ? b.active : true;
      }
      return t !== T.FLOOR;
    },
    tileAt(cx, cy) {
      if (cx < 0 || cy < 0 || cx >= W || cy >= H) return T.STONE;
      return tiles[cy * W + cx];
    },
    lightAt(cx, cy) {
      if (cx < 0 || cy < 0 || cx >= W || cy >= H) return 0.22;
      return light[cy * W + cx];
    },
  };
}

function rollSpawns(rng, depth, bounds, tiles, W, budget) {
  const pool = ROSTER.filter((e) => e.minDepth <= depth);
  const spawns = [];
  let left = budget;
  let guard = 60;
  while (left > 0 && guard-- > 0) {
    const affordable = pool.filter((e) => e.cost <= left);
    if (!affordable.length) break;
    const pick = rng.weighted(affordable);
    const px = rng.int(bounds.x0, bounds.x1) + 0.5;
    const py = rng.int(bounds.y0, bounds.y1) + 0.5;
    if (tiles[Math.floor(py) * W + Math.floor(px)] !== T.FLOOR) continue;
    // Deeper floors sprinkle in elites: rarer members of the pack with a
    // modifier, worth extra budget so the room does not also fill up.
    const elite = depth >= 3 && rng.chance(Math.min(0.2, 0.03 + depth * 0.015))
      ? rng.pick(ELITE_IDS) : null;
    left -= pick.cost + (elite ? 2 : 0);
    spawns.push({ id: pick.id, x: px, y: py, elite });
  }
  return spawns;
}

// Give walls that face open floor some variety.
function decorateWalls(tiles, W, H) {
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (tiles[i] !== T.STONE) continue;
      const facesFloor =
        tiles[i - 1] === T.FLOOR || tiles[i + 1] === T.FLOOR ||
        tiles[i - W] === T.FLOOR || tiles[i + W] === T.FLOOR;
      if (!facesFloor) continue;
      const h = (x * 73856093) ^ (y * 19349663);
      if ((h & 31) === 0) tiles[i] = T.RUNE;
      else if ((h & 3) === 0) tiles[i] = T.BRICK;
    }
  }
}

function placeTorches(tiles, W, H, spine, rng) {
  const out = [];
  for (let i = 3; i < spine.length; i += 4) {
    const c = spine[i];
    for (const [dx, dy] of rng.shuffle([[1, 0], [-1, 0], [0, 1], [0, -1]])) {
      const wx = c.x + dx, wy = c.y + dy;
      if (wx < 1 || wy < 1 || wx >= W - 1 || wy >= H - 1) continue;
      const t = tiles[wy * W + wx];
      if (t === T.FLOOR || t === T.BARRIER) continue;
      out.push({
        kind: 'torch',
        x: c.x + 0.5 + dx * 0.42,
        y: c.y + 0.5 + dy * 0.42,
        z: 0.72,
        hue: rng.pick([[255, 150, 60], [120, 190, 255], [180, 120, 255]]),
        phase: rng.float(0, 6.28),
      });
      break;
    }
  }
  return out;
}

function scatterPickups(tiles, W, spine, rng, depth) {
  const out = [];
  const count = 2 + Math.floor(depth / 3);
  for (let i = 0; i < count; i++) {
    const c = spine[rng.int(Math.floor(spine.length * 0.15), spine.length - 1)];
    if (!c || tiles[c.y * W + c.x] !== T.FLOOR) continue;
    out.push({
      kind: rng.chance(0.5) ? 'health' : 'mana',
      x: c.x + 0.5, y: c.y + 0.5, z: 0.35,
      phase: rng.float(0, 6.28),
      taken: false,
    });
  }
  return out;
}

// Cheap radial lightmap: ambient plus falloff from every torch and the portal.
function buildLightmap(tiles, W, H, props, portal) {
  const light = new Float32Array(W * H).fill(0.3);
  const add = (sx, sy, radius, power) => {
    const x0 = Math.max(0, Math.floor(sx - radius)), x1 = Math.min(W - 1, Math.ceil(sx + radius));
    const y0 = Math.max(0, Math.floor(sy - radius)), y1 = Math.min(H - 1, Math.ceil(sy + radius));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const d = Math.hypot(x + 0.5 - sx, y + 0.5 - sy);
        if (d > radius) continue;
        const f = 1 - d / radius;
        light[y * W + x] += power * f * f;
      }
    }
  };
  for (const p of props) if (p.kind === 'torch') add(p.x, p.y, 7.5, 0.85);
  add(portal.x, portal.y, 8, 0.7);
  for (let i = 0; i < light.length; i++) light[i] = Math.min(1.35, light[i]);
  return light;
}

/**
 * A level is acceptable when the portal is reachable, every arena's seals are a
 * genuine cut in the floor graph, and a boss depth actually delivers a sealed
 * boss chamber.
 */
export function verifyLevel(level, depth) {
  const portalCell = { x: Math.floor(level.portal.x), y: Math.floor(level.portal.y) };
  if (!reaches(level, portalCell, null)) return false;
  if (depth % 5 === 0) {
    const boss = level.encounters.find((e) => e.kind === 'boss');
    if (!boss || boss.seals.length !== 1) return false;
  }
  for (const enc of level.encounters) {
    if (enc.kind !== 'arena' || enc.seals.length !== 2) continue;
    const shut = new Set(enc.seals.map((c) => `${c.x},${c.y}`));
    if (reaches(level, portalCell, shut)) return false;
  }
  return true;
}

function reaches(level, goal, shut) {
  const { w, h, tiles } = level;
  const seen = new Uint8Array(w * h);
  const start = { x: Math.floor(level.spawn.x), y: Math.floor(level.spawn.y) };
  const stack = [start];
  seen[start.y * w + start.x] = 1;
  while (stack.length) {
    const c = stack.pop();
    if (c.x === goal.x && c.y === goal.y) return true;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = c.x + dx, ny = c.y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const i = ny * w + nx;
      if (seen[i]) continue;
      const t = tiles[i];
      if (t !== T.FLOOR && t !== T.BARRIER) continue;
      if (t === T.BARRIER && shut && shut.has(`${nx},${ny}`)) continue;
      seen[i] = 1;
      stack.push({ x: nx, y: ny });
    }
  }
  return false;
}

function stripSeals(level) {
  for (const b of level.barriers.values()) { b.active = false; b.open = true; }
  for (const enc of level.encounters) enc.seals = [];
  return level;
}

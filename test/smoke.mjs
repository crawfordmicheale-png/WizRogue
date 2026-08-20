// Generator invariants: every level is walkable end to end, and each sealed
// arena genuinely gates the route (proving the corridor never branches around it).
import { generateLevel, T } from '../src/world/mapgen.js';

let failures = 0;
const fail = (msg) => { console.error('FAIL:', msg); failures++; };

function reachable(level, { treatSealedAsSolid = false, sealSet = null } = {}) {
  const { w, h, tiles } = level;
  const start = { x: Math.floor(level.spawn.x), y: Math.floor(level.spawn.y) };
  const seen = new Uint8Array(w * h);
  const queue = [start];
  seen[start.y * w + start.x] = 1;
  while (queue.length) {
    const c = queue.pop();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = c.x + dx, ny = c.y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const i = ny * w + nx;
      if (seen[i]) continue;
      const t = tiles[i];
      if (t !== T.FLOOR && t !== T.BARRIER) continue;
      if (t === T.BARRIER && treatSealedAsSolid && sealSet && sealSet.has(`${nx},${ny}`)) continue;
      seen[i] = 1;
      queue.push({ x: nx, y: ny });
    }
  }
  return seen;
}

let arenasChecked = 0, totalEnemies = 0, levels = 0, spineTotal = 0;
const t0 = Date.now();
for (let depth = 1; depth <= 20; depth++) {
  for (let s = 0; s < 60; s++) {
    const seed = depth * 7919 + s * 104729;
    const level = generateLevel(seed, depth);
    levels++;
    spineTotal += level.spine.length;
    if (level.spine.length < 25) fail(`depth ${depth} seed ${seed}: level is only ${level.spine.length} cells long`);

    const px = Math.floor(level.portal.x), py = Math.floor(level.portal.y);
    const seen = reachable(level);
    if (!seen[py * level.w + px]) fail(`depth ${depth} seed ${seed}: portal unreachable`);
    if (level.tiles[Math.floor(level.spawn.y) * level.w + Math.floor(level.spawn.x)] !== T.FLOOR)
      fail(`depth ${depth} seed ${seed}: spawn inside solid rock`);

    if (depth % 5 === 0) {
      const boss = level.encounters.find((e) => e.kind === 'boss');
      if (!boss) fail(`depth ${depth} seed ${seed}: boss depth has no Warden`);
      else if (boss.seals.length !== 1) fail(`depth ${depth} seed ${seed}: boss chamber is not sealed`);
    }

    for (const enc of level.encounters) {
      totalEnemies += enc.spawns.length;
      if (!enc.spawns.length) fail(`depth ${depth} seed ${seed}: empty encounter`);
      for (const sp of enc.spawns) {
        const t = level.tiles[Math.floor(sp.y) * level.w + Math.floor(sp.x)];
        if (t !== T.FLOOR) fail(`depth ${depth} seed ${seed}: ${sp.id} spawned in solid rock`);
      }
      if (enc.kind !== 'arena' || enc.seals.length !== 2) continue;
      arenasChecked++;
      const sealSet = new Set(enc.seals.map((c) => `${c.x},${c.y}`));
      const gated = reachable(level, { treatSealedAsSolid: true, sealSet });
      if (gated[py * level.w + px])
        fail(`depth ${depth} seed ${seed}: arena ${enc.id} can be bypassed — route is not linear`);
    }
  }
}

console.log(`levels: ${levels}, sealed arenas verified: ${arenasChecked}, enemies placed: ${totalEnemies}`);
console.log(`average corridor length: ${(spineTotal / levels).toFixed(1)} cells, generated in ${Date.now() - t0}ms`);
console.log(failures ? `${failures} failure(s)` : 'all generator invariants hold');
process.exit(failures ? 1 : 0);

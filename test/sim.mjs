// Headless playthrough. Game holds no DOM references outside collectSprites, so a
// whole run can be simulated in Node at thousands of frames a second. This catches
// soft-locks, unreachable portals and NaN drift that a short browser session misses.
import { Game } from '../src/game/game.js';
import { ARCHETYPES } from '../src/game/archetypes.js';
import { rollRewards } from '../src/game/rewards.js';
import { makeRng } from '../src/util/rng.js';

const STEP = 1 / 60;
const MINUTES = Number(process.env.SIM_MINUTES || 6);
const STEPS_PER_RUN = Math.round((60 / STEP) * MINUTES);

class FakeInput {
  constructor() { this.held = new Set(); this.lookX = 0; this.lookY = 0; }
  down(a) { return this.held.has(a); }
  pressed() { return false; }
  consumeLook() { this.lookX = 0; this.lookY = 0; }
  consumeWheel() { return 0; }
}

let failures = 0;
const fail = (m) => { console.error('FAIL:', m); failures++; };

function playRun(archetypeId, seed) {
  const rng = makeRng(seed);
  const input = new FakeInput();
  let clears = 0;
  let pendingReward = false;

  const game = new Game(null, null, {
    onLevelClear: () => { pendingReward = true; },
    onDeath: () => {},
  });
  game.startRun(archetypeId, seed);

  let wp = 0;
  let lastPos = { x: 0, y: 0 };
  let stuckFor = 0;
  let strafe = 1;
  const stats = { depth: 1, kills: 0, casts: 0, stuckEvents: 0, stall: null };
  let depthSince = 0, lastDepth = 1;
  const trail = [];

  for (let step = 0; step < STEPS_PER_RUN; step++) {
    if (game.state === 'dead') break;

    if (pendingReward) {
      pendingReward = false;
      const options = rollRewards(game, rng.next);
      const choice = options[Math.floor(rng.next() * options.length)];
      if (choice.needsSlot) choice.slot = Math.floor(rng.next() * game.player.unlocked);
      game.applyReward(choice);
      game.nextDepth();
      wp = 0;
      clears++;
      continue;
    }

    const p = game.player;
    const level = game.level;

    // --- pick a target -----------------------------------------------------
    let target = null, best = Infinity;
    for (const e of game.enemies) {
      if (e.dead) continue;
      const d = Math.hypot(e.x - p.x, e.y - p.y);
      if (d < best && d < 13 && game.hasLineOfSight(p.x, p.y, e.x, e.y)) { best = d; target = e; }
    }
    // While sealed in, hunt whatever is left even without line of sight.
    const live = level.encounters.find((e) => e.triggered && !e.cleared);
    if (!target && live) {
      for (const e of game.enemies) {
        if (e.dead || e.encounter !== live) continue;
        const d = Math.hypot(e.x - p.x, e.y - p.y);
        if (d < best) { best = d; target = e; }
      }
    }

    input.held.clear();
    if (target) {
      p.angle = Math.atan2(target.y - p.y, target.x - p.x);
      if (game.hasLineOfSight(p.x, p.y, target.x, target.y)) {
        for (let i = 0; i < p.unlocked; i++) {
          const s = p.slots[i];
          if (!s) continue;
          const st = p.statsFor(i);
          if (p.cooldowns[i] > 0 || p.mana < st.cost) continue;
          if (st.kind === 'self' && p.health > p.maxHealth * 0.5) continue;
          if ((st.kind === 'nova' || st.kind === 'cone') && best > (st.range || 4) * 0.8) continue;
          if (st.kind === 'self' && st.effect === 'blink') continue;
          p.selected = i;
          if (game.tryCast(i)) stats.casts++;
          break;
        }
      }
      // Kite: hold a caster's distance, back off when anything closes.
      const crowd = game.enemies.filter((e) => !e.dead && Math.hypot(e.x - p.x, e.y - p.y) < 4).length;
      if (best < 5 || crowd > 1) { input.held.add('back'); input.held.add('sprint'); }
      else if (best > 8.5) input.held.add('forward');
      input.held.add(strafe > 0 ? 'right' : 'left');
    } else {
      // Walk the corridor spine, aiming at the furthest waypoint still in sight
      // so corners get cut instead of walked into.
      const spine = level.spine;
      while (wp < spine.length - 1 &&
             Math.hypot(spine[wp].x + 0.5 - p.x, spine[wp].y + 0.5 - p.y) < 1.2) wp++;
      let goal = { x: spine[Math.min(wp, spine.length - 1)].x + 0.5, y: spine[Math.min(wp, spine.length - 1)].y + 0.5 };
      for (let k = Math.min(wp + 8, spine.length - 1); k > wp; k--) {
        const c = { x: spine[k].x + 0.5, y: spine[k].y + 0.5 };
        if (Math.hypot(c.x - p.x, c.y - p.y) < 7 && game.hasLineOfSight(p.x, p.y, c.x, c.y)) { goal = c; wp = k; break; }
      }
      p.angle = Math.atan2(goal.y - p.y, goal.x - p.x);
      input.held.add('forward');
      if (stuckFor > 0.4) input.held.add(strafe > 0 ? 'right' : 'left');
    }

    game.update(STEP, input);

    if (step % 30 === 0) {
      trail.push(`${p.x.toFixed(1)},${p.y.toFixed(1)}|v${Math.hypot(p.vx, p.vy).toFixed(1)}|hp${Math.round(p.health)}|m${Math.round(p.mana)}`);
      if (trail.length > 40) trail.shift();
    }

    // A run that stops descending is as bad as a crash — capture why.
    if (game.depth !== lastDepth) { lastDepth = game.depth; depthSince = 0; }
    else if ((depthSince += STEP) > 100 && !stats.stall) {
      const liveEnc = level.encounters.find((e) => e.triggered && !e.cleared);
      stats.stall = {
        depth: game.depth,
        at: [+p.x.toFixed(1), +p.y.toFixed(1)],
        portalAt: [+level.portal.x.toFixed(1), +level.portal.y.toFixed(1)],
        distToPortal: +Math.hypot(p.x - level.portal.x, p.y - level.portal.y).toFixed(1),
        sealedIn: liveEnc ? liveEnc.id : null,
        remaining: game.enemies.filter((e) => !e.dead).map(
          (e) => `${e.typeId}@${e.x.toFixed(1)},${e.y.toFixed(1)}${e.awake ? '' : ' asleep'}${e.encounter ? '' : ' roamer'}`),
        activeSeals: [...level.barriers.values()].filter((b) => b.active).length,
        cooldowns: game.player.cooldowns.map((c) => +c.toFixed(1)),
        loadout: game.player.slots.map((sl) => (sl ? sl.id : null)),
        trail: trail.slice(-20),
      };
      break;
    }

    // --- stuck detection ---------------------------------------------------
    const moved = Math.hypot(p.x - lastPos.x, p.y - lastPos.y);
    if (moved < 0.004) {
      stuckFor += STEP;
      if (stuckFor > 1.2) { strafe = -strafe; stuckFor = 0; stats.stuckEvents++; }
    } else stuckFor = 0;
    lastPos = { x: p.x, y: p.y };

    // --- invariants --------------------------------------------------------
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.health))
      { fail(`${archetypeId} seed ${seed}: player state went non-finite at depth ${game.depth}`); break; }
    if (level.solid(Math.floor(p.x), Math.floor(p.y)))
      { fail(`${archetypeId} seed ${seed}: player ended up inside solid rock at depth ${game.depth}`); break; }
    for (const enc of level.encounters) {
      if (!enc.cleared) continue;
      for (const seal of enc.seals) {
        if (level.barriers.get(`${seal.x},${seal.y}`)?.active)
          fail(`${archetypeId} seed ${seed}: seal stayed shut after encounter ${enc.id} was cleared`);
      }
    }
    stats.depth = game.depth;
    stats.kills = game.runKills;
  }

  return { ...stats, clears, died: game.state === 'dead', alive: Math.round(game.player.health) };
}

const t0 = Date.now();
const rows = [];
for (const a of ARCHETYPES) {
  for (let i = 0; i < 3; i++) {
    const seed = 1337 + i * 4211;
    rows.push({ archetype: a.name, seed, ...playRun(a.id, seed) });
  }
}
const elapsed = (Date.now() - t0) / 1000;

console.log(`simulated ${rows.length} runs of ${MINUTES} minutes each in ${elapsed.toFixed(1)}s\n`);
console.log('archetype      seed   depth kills casts died  hp');
for (const r of rows) {
  console.log(
    `${r.archetype.padEnd(14)} ${String(r.seed).padEnd(6)} ${String(r.depth).padEnd(5)} ` +
    `${String(r.kills).padEnd(5)} ${String(r.casts).padEnd(5)} ${String(r.died).padEnd(5)} ${r.alive}`,
  );
}
for (const r of rows) {
  if (!r.stall) continue;
  console.log(`\nSTALL ${r.archetype} seed ${r.seed}: ${JSON.stringify(r.stall)}`);
  fail(`${r.archetype} seed ${r.seed}: run stopped progressing at depth ${r.stall.depth} for 100s`);
}
const maxDepth = Math.max(...rows.map((r) => r.depth));
const avgDepth = rows.reduce((a, r) => a + r.depth, 0) / rows.length;
console.log(`\ndeepest run: ${maxDepth}, average: ${avgDepth.toFixed(1)}, cleared depths: ${rows.reduce((a, r) => a + r.clears, 0)}`);
if (maxDepth < 4) fail(`no run got past depth ${maxDepth} — progression is blocked somewhere`);
if (avgDepth < 2.5) fail(`average run only reached depth ${avgDepth.toFixed(1)} — early difficulty is too steep`);
console.log(failures ? `\n${failures} failure(s)` : '\nno soft-locks, no invalid states');
process.exit(failures ? 1 : 0);

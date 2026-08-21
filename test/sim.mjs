// Headless playthrough. Game holds no DOM references outside collectSprites, so a
// whole run can be simulated in Node at thousands of frames a second. This catches
// soft-locks, unreachable portals and NaN drift that a short browser session misses.
import { Game } from '../src/game/game.js';
import { ARCHETYPES } from '../src/game/archetypes.js';
import { rollRewards } from '../src/game/rewards.js';
import { makeRng } from '../src/util/rng.js';
import { collides } from '../src/game/enemies.js';

const STEP = 1 / 60;
const MINUTES = Number(process.env.SIM_MINUTES || 6);
// Seeds per archetype. Three keeps CI quick; raise it when measuring balance,
// where a 15-run sample is far too noisy to tune against.
const RUNS = Number(process.env.SIM_RUNS || 3);
const STEPS_PER_RUN = Math.round((60 / STEP) * MINUTES);

class FakeInput {
  constructor() { this.held = new Set(); this.lookX = 0; this.lookY = 0; }
  down(a) { return this.held.has(a); }
  pressed() { return false; }
  moveAxes() {
    return {
      f: (this.down('forward') ? 1 : 0) - (this.down('back') ? 1 : 0),
      s: (this.down('right') ? 1 : 0) - (this.down('left') ? 1 : 0),
    };
  }
  consumeLook() { this.lookX = 0; this.lookY = 0; }
  consumeWheel() { return 0; }
}

// Which slot a new spell replaces. The bot used to pick at random, which let it
// discard every damage spell it owned and then stand in a sealed arena with
// nothing it could cast — a stalemate no real player would walk into, and one
// that reads as a game soft-lock when it is nothing of the kind.
function pickSlot(player, rng) {
  const n = player.unlocked;
  for (let i = 0; i < n; i++) if (!player.slots[i]) return i;
  const attacks = [];
  for (let i = 0; i < n; i++) {
    const kind = player.statsFor(i).kind;
    if (kind === 'bolt' || kind === 'beam') attacks.push(i);
  }
  const safe = [];
  for (let i = 0; i < n; i++) {
    if (attacks.length <= 1 && attacks.includes(i)) continue;   // keep the last one
    safe.push(i);
  }
  const pool = safe.length ? safe : [0];
  return pool[Math.floor(rng.next() * pool.length)];
}

// Breadth-first route between two tiles. The bot steers with line of sight,
// which is enough in a corridor but strands it whenever the thing it is hunting
// sits around a corner — it would hold position forever, never getting a shot.
// A real route removes that whole class of false soft-lock, and it only runs
// when sight has already failed.
function stepToward(level, from, to) {
  const w = level.w, h = level.h;
  const start = Math.floor(from.y) * w + Math.floor(from.x);
  const goal = Math.floor(to.y) * w + Math.floor(to.x);
  if (start === goal) return { x: to.x, y: to.y };
  const prev = new Int32Array(w * h).fill(-1);
  const seen = new Uint8Array(w * h);
  const queue = [start];
  seen[start] = 1;
  let head = 0, found = false;
  while (head < queue.length) {
    const cur = queue[head++];
    if (cur === goal) { found = true; break; }
    const cx = cur % w, cy = (cur / w) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = ny * w + nx;
      if (seen[ni] || level.solid(nx, ny)) continue;
      seen[ni] = 1; prev[ni] = cur; queue.push(ni);
    }
  }
  if (!found) return null;
  let cur = goal;
  while (prev[cur] !== -1 && prev[cur] !== start) cur = prev[cur];
  return { x: (cur % w) + 0.5, y: ((cur / w) | 0) + 0.5 };
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
  // Per-frame immobility is too twitchy a signal: nudging into a corner still
  // yields millimetres of drift, which resets it. Progress is measured over a
  // window instead — a bot that has not covered a tile in four seconds is lost.
  let embedded = 0;
  let navFallback = 0;
  let route = null, routeAge = 0;
  let reachDebug = 0;
  let anchorPos = { x: 0, y: 0 };
  let anchorTimer = 0;
  let noProgress = false;
  let strafe = 1;
  const stats = { depth: 1, kills: 0, casts: 0, stuckEvents: 0, reanchors: 0, stall: null, embedded: null };
  let depthSince = 0, lastDepth = 1;
  let lastLiveHp = -1, lastHealth = -1, stalemate = 0;
  const trail = [];

  for (let step = 0; step < STEPS_PER_RUN; step++) {
    if (game.state === 'dead') break;

    if (pendingReward) {
      pendingReward = false;
      const options = rollRewards(game, rng.next);
      const choice = options[Math.floor(rng.next() * options.length)];
      if (choice.needsSlot) choice.slot = pickSlot(game.player, rng);
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
    const blindHunt = target && !game.hasLineOfSight(p.x, p.y, target.x, target.y);
    if (target && !(navFallback > 0 && blindHunt)) {
      p.angle = Math.atan2(target.y - p.y, target.x - p.x);
      if (game.hasLineOfSight(p.x, p.y, target.x, target.y)) {
        // Pick the cheapest attack that reaches, and only fall back to a ward
        // or a heal when actually hurt. Taking spells in slot order meant
        // re-warding on cooldown until there was no mana left to attack with —
        // a stalemate of the bot's own making, not the game's.
        let pick = -1, pickCost = Infinity, urgent = -1;
        for (let i = 0; i < p.unlocked; i++) {
          if (!p.slots[i]) continue;
          const st = p.statsFor(i);
          if (p.cooldowns[i] > 0 || p.mana < st.cost) continue;
          if (st.kind === 'self') {
            if (st.effect === 'blink') continue;
            if (p.health > p.maxHealth * 0.5) continue;
            if (st.effect === 'shield' && p.shieldTime > 0) continue;
            if (urgent < 0) urgent = i;
            continue;
          }
          if ((st.kind === 'nova' || st.kind === 'cone') && best > (st.range || 4) * 0.8) continue;
          if (st.cost < pickCost) { pick = i; pickCost = st.cost; }
        }
        // Keep enough in reserve to actually fight back.
        if (urgent >= 0 && (pick < 0 || p.mana > p.maxMana * 0.5)) pick = urgent;
        if (pick >= 0) {
          p.selected = pick;
          if (game.tryCast(pick)) stats.casts++;
        }
      }
      // How close this loadout has to be to do anything at all. A bolt reaches
      // across the room; a cone has to be walked into range, and kiting to a
      // flat 5 tiles with only a cone in hand is a stalemate.
      let reach = 0;
      for (let i = 0; i < p.unlocked; i++) {
        if (!p.slots[i]) continue;
        const st = p.statsFor(i);
        if (st.kind === 'bolt' || st.kind === 'beam') reach = Math.max(reach, 11);
        else if (st.kind === 'nova' || st.kind === 'cone') reach = Math.max(reach, (st.range || 4) * 0.7);
      }
      if (reach === 0) reach = 2;
      reachDebug = reach;
      const kiteAt = Math.min(5, reach * 0.8);

      const crowd = game.enemies.filter((e) => !e.dead && Math.hypot(e.x - p.x, e.y - p.y) < 4).length;
      // Range only matters once you can see the target: hanging back at eleven
      // tiles from something behind a corner means never getting a shot off.
      // Out of sight, walk the route to it rather than into the wall between.
      if (blindHunt) {
        if ((routeAge -= STEP) <= 0) { route = stepToward(level, p, target); routeAge = 0.5; }
        if (route) p.angle = Math.atan2(route.y - p.y, route.x - p.x);
      } else route = null;
      if (best > reach || blindHunt) input.held.add('forward');
      else if (best < kiteAt || crowd > 1) { input.held.add('back'); input.held.add('sprint'); }
      input.held.add(strafe > 0 ? 'right' : 'left');
    } else {
      // Walk the corridor spine, aiming at the furthest waypoint still in sight
      // so corners get cut instead of walked into. Also used when a sealed-in
      // target sits behind cover: walking straight at it just grinds a wall,
      // so fall back to following the route for a few seconds.
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

      // The waypoint index only ever moves forward, so a bot shoved backwards
      // through a doorway mid-fight keeps aiming at a waypoint that is now
      // behind a wall and grinds into the corner. Re-anchor to the nearest
      // waypoint it can actually see in a straight line. Without this the bot
      // strands itself and reports a soft-lock the game does not have.
      if (noProgress) {
        noProgress = false;
        let bi = -1, bd = Infinity;
        for (let i = 0; i < spine.length; i++) {
          const c = { x: spine[i].x + 0.5, y: spine[i].y + 0.5 };
          const d = Math.hypot(c.x - p.x, c.y - p.y);
          if (d < bd && game.hasLineOfSight(p.x, p.y, c.x, c.y)) { bd = d; bi = i; }
        }
        if (bi >= 0) { wp = bi; stats.reanchors++; }
        strafe = -strafe;
      }
    }

    // Grinding a wall while hunting: hand movement back to the route walker.
    if (noProgress && target) { navFallback = 3; noProgress = false; stats.reanchors++; }
    if (navFallback > 0) navFallback -= STEP;

    game.update(STEP, input);

    if (step % 30 === 0) {
      trail.push(`${p.x.toFixed(1)},${p.y.toFixed(1)}|v${Math.hypot(p.vx, p.vy).toFixed(1)}|hp${Math.round(p.health)}|m${Math.round(p.mana)}`);
      if (trail.length > 40) trail.shift();
    }

    // A boss with a big health pool legitimately takes a while, so measuring
    // "no depth change" alone flags real fights as soft-locks. What actually
    // distinguishes a stuck run is that nothing is happening at all: no damage
    // dealt, none taken, no descent.
    let liveHp = 0;
    for (const e of game.enemies) if (!e.dead) liveHp += e.hp;
    if (Math.abs(liveHp - lastLiveHp) > 1 || Math.abs(p.health - lastHealth) > 1) {
      lastLiveHp = liveHp; lastHealth = p.health; stalemate = 0;
    } else stalemate += STEP;

    if (game.depth !== lastDepth) { lastDepth = game.depth; depthSince = 0; stalemate = 0; }
    else depthSince += STEP;

    if (stalemate > 100 && !stats.stall) {
      const liveEnc = level.encounters.find((e) => e.triggered && !e.cleared);
      stats.stall = {
        depth: game.depth,
        at: [+p.x.toFixed(1), +p.y.toFixed(1)],
        portalAt: [+level.portal.x.toFixed(1), +level.portal.y.toFixed(1)],
        distToPortal: +Math.hypot(p.x - level.portal.x, p.y - level.portal.y).toFixed(1),
        sealedIn: liveEnc ? liveEnc.id : null,
        // Whether each survivor can be walked to and shot at is the difference
        // between a bot that gave up and a genuinely unwinnable arena.
        remaining: game.enemies.filter((e) => !e.dead).map(
          (e) => `${e.typeId}@${e.x.toFixed(1)},${e.y.toFixed(1)}${e.awake ? '' : ' asleep'}` +
            `${e.encounter ? '#enc' + e.encounter.id : ' roamer'}${collides(level, e.x, e.y, e.radius) ? ' IN-WALL' : ''}` +
            `${stepToward(level, p, e) ? '' : ' NO-ROUTE'}` +
            `${game.hasLineOfSight(p.x, p.y, e.x, e.y) ? ' los' : ''}`),
        activeSeals: [...level.barriers.values()].filter((b) => b.active).length,
        cooldowns: game.player.cooldowns.map((c) => +c.toFixed(1)),
        mana: Math.round(game.player.mana),
        target: target ? `${target.typeId}@${target.x.toFixed(1)},${target.y.toFixed(1)} d=${best.toFixed(1)} los=${game.hasLineOfSight(p.x, p.y, target.x, target.y)}` : 'none',
        reach: +reachDebug.toFixed(1),
        loadout: game.player.slots.map((sl) => (sl ? sl.id : null)),
        trail: trail.slice(-20),
      };
      break;
    }

    // --- progress window ---------------------------------------------------
    if ((anchorTimer += STEP) > 4) {
      noProgress = Math.hypot(p.x - anchorPos.x, p.y - anchorPos.y) < 1;
      anchorPos = { x: p.x, y: p.y };
      anchorTimer = 0;
    }

    // --- stuck detection ---------------------------------------------------
    const moved = Math.hypot(p.x - lastPos.x, p.y - lastPos.y);
    if (moved < 0.004) {
      stuckFor += STEP;
      if (stuckFor > 1.2) { strafe = -strafe; stuckFor = 0; stats.stuckEvents++; }
    } else stuckFor = 0;
    lastPos = { x: p.x, y: p.y };

    // Being inside solid geometry is never survivable: no input can move you
    // out, so it is a permanent soft-lock rather than a difficulty spike.
    if (collides(level, p.x, p.y, p.radius)) embedded += STEP; else embedded = 0;
    if (embedded > 0.5 && !stats.embedded) {
      stats.embedded = { depth: game.depth, at: [+p.x.toFixed(2), +p.y.toFixed(2)] };
    }

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
  for (let i = 0; i < RUNS; i++) {
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
  if (!r.embedded) continue;
  fail(`${r.archetype} seed ${r.seed}: player sealed inside solid geometry at depth ${r.embedded.depth} (${r.embedded.at})`);
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

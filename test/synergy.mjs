// Reward cards advertise reactions, so the advertisement has to match the rules
// that fire them. These check the claim against the same tables combat uses —
// a card promising a combo the game will not produce is worse than silence.
import {
  SPELLS, SPELL_IDS, SYNERGIES, SHATTER_MIN,
  spellProvides, activeSynergies, synergyUnlockedBy, spellStats,
} from '../src/game/spells.js';
import { Enemy } from '../src/game/enemies.js';

let failures = 0;
const fail = (m) => { console.error('FAIL:', m); failures++; };
const slot = (id, rank = 1) => ({ id, rank });

// A stub with just the hooks Enemy.damage reaches for.
const fakeGame = () => ({
  spawnHitBurst() {}, addDamageNumber() {}, synergyHint() {}, audio: null,
  floaters: [], onEnemyDeath() {},
});

// --- every reaction must be reachable from the actual spell pool ------------
for (const [key, syn] of Object.entries(SYNERGIES)) {
  const covered = syn.needs.every((need) =>
    SPELL_IDS.some((id) => spellProvides(id, 1).includes(need)));
  if (!covered) fail(`reaction "${key}" needs [${syn.needs}] but no spell in the pool provides all of them`);
}

// --- "heavy" must mean what the shatter rule means by it --------------------
for (const id of SPELL_IDS) {
  const tags = spellProvides(id, 1);
  const st = spellStats(id, 1);
  const biggest = Math.max(st.dmg || 0, st.blastDmg || 0);
  if (tags.includes('heavy') !== biggest >= SHATTER_MIN)
    fail(`${id}: tagged heavy=${tags.includes('heavy')} but its largest hit is ${biggest} against a ${SHATTER_MIN} threshold`);
}

// A spell the cards call "heavy" really does shatter a chilled target.
for (const id of SPELL_IDS.filter((i) => spellProvides(i, 1).includes('heavy'))) {
  const st = spellStats(id, 1);
  const e = new Enemy('brute', 5, 5, 1);
  e.effects.chill = 3; e.effects.chillSlow = 0.4;
  const before = e.hp;
  e.damage(Math.max(st.dmg || 0, st.blastDmg || 0), fakeGame(), {});
  const dealt = before - e.hp;
  const plain = Math.max(st.dmg || 0, st.blastDmg || 0);
  if (dealt <= plain + 0.001) fail(`${id} is advertised as heavy but did not shatter a chilled target (${dealt} vs ${plain})`);
  if (e.effects.chill !== 0) fail(`${id} shattered without consuming the chill`);
}

// --- the card fires exactly when the loadout is one piece short -------------
const cases = [
  { name: 'conflagrate', have: [slot('emberBolt')], take: 'rotBolt', expect: 'conflagrate', partner: 'Ember Bolt' },
  { name: 'conflagrate reversed', have: [slot('rotBolt')], take: 'emberBolt', expect: 'conflagrate', partner: 'Rot Bolt' },
  { name: 'shatter', have: [slot('frostShard')], take: 'fireball', expect: 'shatter', partner: 'Frost Shard' },
  { name: 'conduction', have: [slot('emberBolt')], take: 'arcBolt', expect: 'conduction', partner: null },
  { name: 'nothing new', have: [slot('emberBolt'), slot('rotBolt')], take: 'witherTouch', expect: null },
  { name: 'no pairing', have: [slot('emberBolt')], take: 'arcaneWard', expect: null },
];
for (const c of cases) {
  const got = synergyUnlockedBy(c.have, c.take, 1);
  if ((got?.key || null) !== c.expect)
    fail(`${c.name}: expected ${c.expect}, got ${got?.key || null}`);
  else if (c.expect && c.partner !== undefined && (got.partner || null) !== c.partner)
    fail(`${c.name}: expected partner ${c.partner}, got ${got.partner}`);
}

// A loadout that already has the reaction must not re-advertise it.
const both = [slot('emberBolt'), slot('rotBolt')];
if (!activeSynergies(both).includes('conflagrate')) fail('burn + poison should already read as conflagrate');
if (synergyUnlockedBy(both, 'flameWave', 1)) fail('conflagrate was advertised again on a loadout that already has it');

// --- an empower that crosses the threshold should say so -------------------
const missile = spellStats('arcaneMissile', 1);
if (missile.dmg >= SHATTER_MIN) {
  console.log(`note: arcaneMissile already heavy at rank 1 (${missile.dmg}) — threshold case not exercised`);
} else {
  const r2 = spellStats('arcaneMissile', 2);
  const got = synergyUnlockedBy([slot('frostShard')], 'arcaneMissile', 2);
  if (r2.dmg >= SHATTER_MIN && got?.key !== 'shatter')
    fail(`arcaneMissile at rank 2 hits for ${r2.dmg} (>= ${SHATTER_MIN}) but the empower card does not offer shatter`);
}

console.log(failures ? `${failures} failure(s)` : 'reward cards match the reactions the game actually fires');
process.exit(failures ? 1 : 0);

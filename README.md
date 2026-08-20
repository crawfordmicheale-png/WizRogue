# WizRogue

A first-person spell-casting roguelike that runs in the browser. No engine, no build step,
no dependencies — a raycasting renderer, procedural textures and synthesised audio, all
written from scratch.

You pick an archetype, carry a loadout of up to five spells, and fight down a chain of
procedurally generated corridors. The route is strictly linear: one way in, one way on,
sealed arenas in between.

## Running it

The game is plain ES modules, so it needs to be served over HTTP (opening `index.html`
straight off disk will not load the modules).

```sh
python3 -m http.server 8080     # or: npx serve .
```

Then open <http://localhost:8080>. Click the canvas to capture the mouse.

## Controls

| Action | Key |
| --- | --- |
| Move | `W` `A` `S` `D` |
| Look | mouse (or `←` `→` to turn) |
| Cast selected spell | left click or `Space` |
| Select spell | `1`–`5`, or the mouse wheel |
| Sprint | `Shift` |
| Pause | `Esc` |

On a phone or tablet the game switches to touch controls automatically (append
`?touch` to the URL to force them): the left half of the screen is a floating
movement stick (push it to the edge to sprint), dragging the right half looks
around, the big round button casts the selected spell, and tapping a loadout
slot selects it. A left-handed layout, vibration and aim assist live in
Settings.

Gamepads work too (standard mapping): left stick moves, right stick looks,
`A`/`RT` casts, `LB`/`RB` cycle spells, `LT`/`L3` sprints, `Start` pauses.

The title screen also offers a **daily corridor** — one shared seed per UTC
day — and remembers your deepest descent. Daily results can be copied to the
clipboard from the death screen to compare with friends. The game is an
installable PWA and keeps working offline once loaded.

A run in progress is snapshotted at the start of every depth. If the tab is
closed (or the game crashes), the title screen offers to **continue** from the
top of the floor you were on; dying or abandoning clears the save.

## The run

* **Five archetypes.** Pyromancer, Cryomancer, Stormcaller, Plaguebinder and Arcanist —
  each starts with two spells and different dials on health, mana, regeneration, movement
  speed, cooldowns and school damage.
* **Five loadout slots, earned.** You begin with two. The third, fourth and fifth unlock at
  depths 3, 5 and 7. Once all five are filled, taking a new spell means overwriting one.
* **Nineteen spells** across five schools — travelling bolts, chaining beams, novas that
  clear the ring around you, forward cones, and self-buffs (ward, blink, heal). Each can be
  empowered twice, which raises its damage and lowers its cost.
* **Clear a depth, take a boon.** Three cards after every level: a new spell, an empowerment,
  or a permanent stat gain.
* **Spell synergies.** Status effects interact: a heavy blow *shatters* a chilled target for
  bonus damage, a foe both burning and poisoned takes extra damage from everything
  (*conflagrate*), and shock *arcs* to the nearest enemy when its host dies (*conduction*).
* **Elites.** From depth 3, packs can include Swift, Stoneskin, Vampiric or Volatile elites —
  bigger, tinted, always worth a pickup, and each with a twist (Volatiles explode on death).
* **Biomes.** Every five depths the corridor changes region — Catacombs, Rust Vaults, Frozen
  Reach, Living Rot, Void Beneath — each with its own colour cast and fog.
* **Every fifth depth is a Warden** — a boss guarding the portal. The classic Corridor Warden
  slams and fires spread volleys; from depth 10 you may instead meet the Warden of the Veil,
  a blinking caster with homing bursts.

The audio is fully synthesised, including a generative ambient score: a drone whose root note
sinks as you descend, a pulse that kicks in when an arena seals, and a motif for the Wardens.
Enemy sounds are positional — pan and volume follow direction and distance.

Death ends the run. There is no meta-progression to grind; the next run starts clean.

## How levels are generated

`src/world/mapgen.js` walks a cursor through a tile grid, carving one segment at a time:
a corridor, then either a junction pad or an arena. It never carves a second opening, so
each level is a single unbranching chain from the spawn alcove to the portal.

Linearity is enforced structurally rather than hoped for. Every carve gets an incrementing
id and stamps its footprint (dilated by two cells) with that id. A new carve may only touch
cells belonging to the carve immediately before it — anything older would mean the corridor
had looped back and opened a second route, so that placement is rejected and another
heading is tried.

Arenas are sealed at both ends by energy barriers that close when you step in and drop when
the last enemy falls. `npm test` verifies this on 500 generated levels: the portal must be
reachable, no enemy may spawn inside rock, and with any single arena's two seals treated as
solid the portal must become *unreachable* — which is only true if the route really is linear.

```
$ npm test
levels: 500, sealed arenas verified: 1484, enemies placed: 15959
all generator invariants hold
```

## Layout

```
index.html            shell: canvas, HUD, overlay
styles.css            HUD, touch controls and menu styling
sw.js                 service worker: offline cache
manifest.webmanifest  PWA install metadata
src/
  main.js             app state machine and the frame loop
  config.js           tuning knobs
  settings.js         persisted preferences, best-run record, daily seed, run save
  util/rng.js         seeded mulberry32 RNG and math helpers
  world/mapgen.js     linear corridor generation, seals, lightmap
  render/
    textures.js       procedural walls, seals, creature sprites
    raycaster.js      DDA walls, floor casting, z-buffered sprites, hands
  game/
    game.js           simulation: casting, projectiles, encounters, effects
    player.js         movement, loadout, resources
    enemies.js        enemy stats and AI
    spells.js         spell data and rank scaling
    archetypes.js     starting kits
    rewards.js        post-depth boon selection
  ui/
    input.js          keyboard, mouse, gamepad, pointer lock
    touch.js          virtual stick, look drag, cast button
    audio.js          WebAudio synthesis: effects, generative music, positional pan
    haptics.js        vibration on phones
    hud.js            live HUD
    menus.js          title, archetype select, rewards, pause, death, settings
test/smoke.mjs        generator invariants
```

## Notes on the renderer

Everything is drawn into a single `ImageData` buffer at a fixed 270px internal height (width
follows the window aspect), then scaled up with nearest-neighbour filtering. Walls use a DDA
grid march with per-column texture sampling; floors and ceilings are cast per row; sprites are
projected into camera space, sorted back to front and clipped against the wall z-buffer, with
an additive path for glows, bolts and particles. Lighting comes from a per-tile lightmap baked
at generation time from torch and portal positions. A full frame costs about 3.4ms.

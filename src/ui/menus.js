import { ARCHETYPES } from '../game/archetypes.js';
import { SPELLS, SCHOOLS, spellStats } from '../game/spells.js';

const rgb = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class Menus {
  constructor(root = document) {
    this.el = root.getElementById('overlay');
    this.keyHandler = null;
  }

  get open() { return this.el.classList.contains('on'); }

  hide() {
    this.el.classList.remove('on');
    this.el.innerHTML = '';
    this.detachKeys();
  }

  attachKeys(map) {
    this.detachKeys();
    this.keyHandler = (e) => {
      const fn = map[e.key];
      if (fn) { e.preventDefault(); fn(); }
    };
    window.addEventListener('keydown', this.keyHandler);
  }

  detachKeys() {
    if (this.keyHandler) window.removeEventListener('keydown', this.keyHandler);
    this.keyHandler = null;
  }

  render(html) {
    this.el.innerHTML = `<div class="screen">${html}</div>`;
    this.el.classList.add('on');
    this.el.scrollTop = 0;
  }

  // --- title --------------------------------------------------------------
  title(onStart) {
    this.render(`
      <h1 class="title">WizRogue</h1>
      <p class="subtitle">Five spells · one corridor · no way back</p>
      <p style="color:var(--dim);max-width:560px;margin:0 auto;font-size:12.5px;line-height:1.8">
        You are walking a corridor that only goes one way. Pick an archetype, carry up to five spells,
        and see how far down you get before something in the dark is faster than your cooldowns.
      </p>
      <div class="keys">
        <span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> <b>move</b></span>
        <span><kbd>Mouse</kbd> <b>look</b></span>
        <span><kbd>Click</kbd> / <kbd>Space</kbd> <b>cast</b></span>
        <span><kbd>1</kbd>–<kbd>5</kbd> / <kbd>Wheel</kbd> <b>select spell</b></span>
        <span><kbd>Shift</kbd> <b>sprint</b></span>
        <span><kbd>Esc</kbd> <b>pause</b></span>
      </div>
      <div class="row"><button class="btn" id="startBtn">Enter the corridor</button></div>
    `);
    this.el.querySelector('#startBtn').onclick = onStart;
    this.attachKeys({ Enter: onStart, ' ': onStart });
  }

  // --- archetype select ---------------------------------------------------
  archetypes(onPick) {
    const cards = ARCHETYPES.map((a, i) => {
      const spells = a.spells.map((id) => {
        const sp = SPELLS[id];
        return `<li><span style="color:${rgb(SCHOOLS[sp.school].color)}">${sp.glyph}</span> ${esc(sp.name)} — ${esc(sp.desc)}</li>`;
      }).join('');
      const st = a.stats;
      return `
        <button class="card" data-i="${i}" style="--accent:${a.accent}">
          <span class="idx">${i + 1}</span>
          <span class="kicker">${esc(a.tagline)}</span>
          <h3>${esc(a.name)}</h3>
          <p>${esc(a.blurb)}</p>
          <ul>
            <li>${st.health} vitality · ${st.mana} mana · ${st.regen}/s regen</li>
            ${spells}
          </ul>
        </button>`;
    }).join('');

    this.render(`
      <h2 class="section-title">Choose your discipline</h2>
      <p class="section-sub">Two spells to start. Slots three, four and five open at depths 3, 5 and 7.</p>
      <div class="cards">${cards}</div>
    `);

    const pick = (i) => onPick(ARCHETYPES[i].id);
    this.el.querySelectorAll('.card').forEach((c) => { c.onclick = () => pick(+c.dataset.i); });
    const map = {};
    ARCHETYPES.forEach((_, i) => { map[String(i + 1)] = () => pick(i); });
    this.attachKeys(map);
  }

  // --- reward after each depth -------------------------------------------
  rewards(options, player, depth, onChoose) {
    const cards = options.map((o, i) => `
      <button class="card" data-i="${i}" style="--accent:${rgb(o.color)}">
        <span class="idx">${i + 1}</span>
        <span class="big">${o.glyph}</span>
        <span class="kicker">${esc(o.kicker)}</span>
        <h3>${esc(o.title)}</h3>
        <p>${esc(o.body)}</p>
        ${o.type === 'spell' ? `<span class="tag">${esc(spellLine(o.spellId, player))}</span>` : ''}
      </button>`).join('');

    this.render(`
      <h2 class="section-title">Depth ${depth} cleared</h2>
      <p class="section-sub">Take one boon before you go down.</p>
      <div class="cards">${cards}</div>
      ${loadoutStrip(player, false)}
    `);

    const choose = (i) => {
      const opt = options[i];
      if (opt.needsSlot) this.replaceSlot(opt, player, onChoose);
      else onChoose(opt);
    };
    this.el.querySelectorAll('.card').forEach((c) => { c.onclick = () => choose(+c.dataset.i); });
    const map = {};
    options.forEach((_, i) => { map[String(i + 1)] = () => choose(i); });
    this.attachKeys(map);
  }

  replaceSlot(option, player, onChoose) {
    const sp = SPELLS[option.spellId];
    this.render(`
      <h2 class="section-title">Your loadout is full</h2>
      <p class="section-sub">Choose a slot to overwrite with ${esc(sp.name)}.</p>
      ${loadoutStrip(player, true)}
      <div class="row"><button class="btn ghost" id="backBtn">Back</button></div>
    `);
    const finish = (slot) => onChoose({ ...option, slot });
    this.el.querySelectorAll('.mini.pickable').forEach((m) => { m.onclick = () => finish(+m.dataset.slot); });
    this.el.querySelector('#backBtn').onclick = () => this.rewardsBack?.();
    const map = {};
    for (let i = 0; i < player.unlocked; i++) if (player.slots[i]) map[String(i + 1)] = () => finish(i);
    this.attachKeys(map);
  }

  // --- pause --------------------------------------------------------------
  pause({ onResume, onAbandon, muted, onToggleMute }) {
    this.render(`
      <h2 class="section-title">Paused</h2>
      <p class="section-sub">The corridor waits.</p>
      <div class="row">
        <button class="btn" id="resumeBtn">Resume</button>
        <button class="btn ghost" id="muteBtn">${muted ? 'Sound: off' : 'Sound: on'}</button>
        <button class="btn ghost" id="abandonBtn">Abandon run</button>
      </div>
      <div class="keys">
        <span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> <b>move</b></span>
        <span><kbd>Mouse</kbd> <b>look</b></span>
        <span><kbd>Click</kbd> / <kbd>Space</kbd> <b>cast</b></span>
        <span><kbd>1</kbd>–<kbd>5</kbd> / <kbd>Wheel</kbd> <b>select</b></span>
        <span><kbd>Shift</kbd> <b>sprint</b></span>
      </div>
    `);
    this.el.querySelector('#resumeBtn').onclick = onResume;
    this.el.querySelector('#abandonBtn').onclick = onAbandon;
    const mb = this.el.querySelector('#muteBtn');
    mb.onclick = () => { const m = onToggleMute(); mb.textContent = m ? 'Sound: off' : 'Sound: on'; };
    this.attachKeys({ Enter: onResume });
  }

  // --- death --------------------------------------------------------------
  death(stats, player, onRetry, onTitle) {
    const mins = Math.floor(stats.time / 60);
    const secs = Math.floor(stats.time % 60).toString().padStart(2, '0');
    this.render(`
      <h2 class="title" style="font-size:clamp(30px,6vw,54px)">The corridor keeps you</h2>
      <p class="subtitle">${esc(stats.archetype)} · run ended at depth ${stats.depth}</p>
      <div class="stats">
        <div class="stat"><b>${stats.depth}</b><span>depth reached</span></div>
        <div class="stat"><b>${stats.kills}</b><span>slain</span></div>
        <div class="stat"><b>${mins}:${secs}</b><span>survived</span></div>
      </div>
      ${loadoutStrip(player, false)}
      <div class="row">
        <button class="btn" id="retryBtn">New run</button>
        <button class="btn ghost" id="titleBtn">Title screen</button>
      </div>
      <p class="hint">Seed ${stats.seed}</p>
    `);
    this.el.querySelector('#retryBtn').onclick = onRetry;
    this.el.querySelector('#titleBtn').onclick = onTitle;
    this.attachKeys({ Enter: onRetry });
  }
}

function spellLine(id, player) {
  const s = spellStats(id, 1, player.mods);
  const bits = [`${s.cost} mana`, `${s.cd}s`];
  if (s.dmg) bits.push(`${s.dmg} damage`);
  if (s.heal) bits.push(`${s.heal} healing`);
  if (s.shield) bits.push(`${s.shield} ward`);
  return bits.join(' · ');
}

function loadoutStrip(player, pickable) {
  const items = [];
  for (let i = 0; i < 5; i++) {
    const entry = player.slots[i];
    const unlocked = i < player.unlocked;
    const sp = entry ? SPELLS[entry.id] : null;
    const color = sp ? rgb(SCHOOLS[sp.school].color) : '#6d6590';
    const can = pickable && unlocked;
    items.push(`
      <div class="mini${can ? ' pickable' : ''}" data-slot="${i}" style="opacity:${unlocked ? 1 : 0.35}">
        <div class="k">${unlocked ? i + 1 : 'locked'}</div>
        <div class="g" style="color:${color}">${sp ? sp.glyph : '·'}</div>
        <div class="n">${sp ? esc(sp.name) + (entry.rank > 1 ? ` r${entry.rank}` : '') : (unlocked ? 'empty' : '—')}</div>
      </div>`);
  }
  return `<div class="loadout-strip">${items.join('')}</div>`;
}

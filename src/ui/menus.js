import { ARCHETYPES } from '../game/archetypes.js';
import { SPELLS, SCHOOLS, spellStats } from '../game/spells.js';
import { settings, saveSettings } from '../settings.js';

const rgb = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const isTouch = () => document.body.classList.contains('touch');

function controlHints() {
  if (isTouch()) {
    return `
      <div class="keys">
        <span><kbd>Left thumb</kbd> <b>move</b></span>
        <span><kbd>Right thumb</kbd> <b>look</b></span>
        <span><kbd>✦</kbd> <b>hold to cast</b></span>
        <span><kbd>Tap a slot</kbd> <b>select spell</b></span>
        <span><kbd>Push stick out</kbd> <b>sprint</b></span>
      </div>`;
  }
  return `
    <div class="keys">
      <span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> <b>move</b></span>
      <span><kbd>Mouse</kbd> <b>look</b></span>
      <span><kbd>Click</kbd> / <kbd>Space</kbd> <b>cast</b></span>
      <span><kbd>1</kbd>–<kbd>5</kbd> / <kbd>Wheel</kbd> <b>select spell</b></span>
      <span><kbd>Shift</kbd> <b>sprint</b></span>
      <span><kbd>Esc</kbd> <b>pause</b></span>
    </div>`;
}

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
  title({ onStart, onDaily, onSettings, onContinue, best, savedRun }) {
    const continueBtn = savedRun && onContinue
      ? `<button class="btn" id="continueBtn">Continue — depth ${savedRun.depth}${savedRun.dailyLabel ? ' (daily)' : ''}</button>`
      : '';
    this.render(`
      <h1 class="title">WizRogue</h1>
      <p class="subtitle">Five spells · one corridor · no way back</p>
      <p style="color:var(--dim);max-width:560px;margin:0 auto;font-size:12.5px;line-height:1.8">
        You are walking a corridor that only goes one way. Pick an archetype, carry up to five spells,
        and see how far down you get before something in the dark is faster than your cooldowns.
      </p>
      ${controlHints()}
      <div class="row">
        ${continueBtn}
        <button class="btn${continueBtn ? ' ghost' : ''}" id="startBtn">Enter the corridor</button>
        <button class="btn ghost" id="dailyBtn">Daily corridor</button>
        <button class="btn ghost" id="settingsBtn">Settings</button>
      </div>
      ${best ? `<p class="hint">Best descent — depth ${best.depth} · ${best.kills} slain · ${esc(best.archetype)}</p>` : ''}
    `);
    if (continueBtn) this.el.querySelector('#continueBtn').onclick = onContinue;
    this.el.querySelector('#startBtn').onclick = onStart;
    this.el.querySelector('#dailyBtn').onclick = onDaily;
    this.el.querySelector('#settingsBtn').onclick = onSettings;
    const primary = savedRun && onContinue ? onContinue : onStart;
    this.attachKeys({ Enter: primary, ' ': primary });
  }

  // --- settings -------------------------------------------------------------
  settingsMenu({ muted, onToggleMute, onToggleMusic, touch, onBack }) {
    const toggleRow = (id, label, on) => `
      <div class="setting-row">
        <span>${label}</span>
        <button class="pill${on ? ' on' : ''}" id="${id}">${on ? 'On' : 'Off'}</button>
      </div>`;

    this.render(`
      <h2 class="section-title">Settings</h2>
      <p class="section-sub">Kept between runs.</p>
      <div class="settings">
        <div class="setting-row">
          <span>Look sensitivity</span>
          <span class="sens">
            <input type="range" id="sensRange" min="0.4" max="2" step="0.1" value="${settings.sens}">
            <b id="sensVal">${settings.sens.toFixed(1)}×</b>
          </span>
        </div>
        ${toggleRow('shakeBtn', 'Screen shake', settings.shake)}
        ${toggleRow('assistBtn', 'Aim assist (touch & gamepad)', settings.aimAssist)}
        ${touch ? toggleRow('hapticsBtn', 'Vibration', settings.haptics) : ''}
        ${touch ? toggleRow('leftyBtn', 'Left-handed layout', settings.lefty) : ''}
        ${toggleRow('soundBtn', 'Sound', !muted)}
        ${toggleRow('musicBtn', 'Music', settings.music)}
      </div>
      <div class="row"><button class="btn" id="backBtn">Back</button></div>
    `);

    const range = this.el.querySelector('#sensRange');
    const val = this.el.querySelector('#sensVal');
    range.oninput = () => {
      settings.sens = +range.value;
      val.textContent = `${settings.sens.toFixed(1)}×`;
      saveSettings();
    };

    const bindToggle = (id, get, set) => {
      const btn = this.el.querySelector(`#${id}`);
      if (!btn) return;
      btn.onclick = () => {
        const on = set();
        btn.textContent = on ? 'On' : 'Off';
        btn.classList.toggle('on', on);
      };
      void get;
    };
    bindToggle('shakeBtn', () => settings.shake, () => { settings.shake = !settings.shake; saveSettings(); return settings.shake; });
    bindToggle('assistBtn', () => settings.aimAssist, () => { settings.aimAssist = !settings.aimAssist; saveSettings(); return settings.aimAssist; });
    bindToggle('hapticsBtn', () => settings.haptics, () => { settings.haptics = !settings.haptics; saveSettings(); return settings.haptics; });
    bindToggle('leftyBtn', () => settings.lefty, () => {
      settings.lefty = !settings.lefty;
      document.body.classList.toggle('lefty', settings.lefty);
      saveSettings();
      return settings.lefty;
    });
    bindToggle('soundBtn', () => !muted, () => !onToggleMute());
    bindToggle('musicBtn', () => settings.music, () => onToggleMusic());

    this.el.querySelector('#backBtn').onclick = onBack;
    this.attachKeys({}); // clear the previous screen's shortcuts
  }

  // --- archetype select ---------------------------------------------------
  archetypes(onPick, dailyLabel = null) {
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
      <p class="section-sub">${dailyLabel
        ? `Daily corridor · ${esc(dailyLabel)} — everyone descends the same halls today.`
        : 'Two spells to start. Slots three, four and five open at depths 3, 5 and 7.'}</p>
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
  pause({ onResume, onAbandon, onSettings, muted, onToggleMute }) {
    this.render(`
      <h2 class="section-title">Paused</h2>
      <p class="section-sub">The corridor waits.</p>
      <div class="row">
        <button class="btn" id="resumeBtn">Resume</button>
        <button class="btn ghost" id="muteBtn">${muted ? 'Sound: off' : 'Sound: on'}</button>
        <button class="btn ghost" id="settingsBtn">Settings</button>
        <button class="btn ghost" id="abandonBtn">Abandon run</button>
      </div>
      ${controlHints()}
    `);
    this.el.querySelector('#resumeBtn').onclick = onResume;
    this.el.querySelector('#abandonBtn').onclick = onAbandon;
    this.el.querySelector('#settingsBtn').onclick = onSettings;
    const mb = this.el.querySelector('#muteBtn');
    mb.onclick = () => { const m = onToggleMute(); mb.textContent = m ? 'Sound: off' : 'Sound: on'; };
    this.attachKeys({ Enter: onResume });
  }

  // --- death --------------------------------------------------------------
  death(stats, player, { isRecord, dailyLabel, onRetry, onTitle }) {
    const mins = Math.floor(stats.time / 60);
    const secs = Math.floor(stats.time % 60).toString().padStart(2, '0');
    const recap = stats.killedBy ? `Slain by ${esc(article(stats.killedBy))} · ` : '';
    const canShare = !!(navigator.clipboard && dailyLabel);
    this.render(`
      <h2 class="title" style="font-size:clamp(30px,6vw,54px)">The corridor keeps you</h2>
      <p class="subtitle">${recap}${esc(stats.archetype)} · run ended at depth ${stats.depth}${dailyLabel ? ` · daily ${esc(dailyLabel)}` : ''}</p>
      ${isRecord ? '<p class="record">✦ Deepest descent yet ✦</p>' : ''}
      <div class="stats">
        <div class="stat"><b>${stats.depth}</b><span>depth reached</span></div>
        <div class="stat"><b>${stats.kills}</b><span>slain</span></div>
        <div class="stat"><b>${mins}:${secs}</b><span>survived</span></div>
      </div>
      ${loadoutStrip(player, false)}
      <div class="row">
        <button class="btn" id="retryBtn">New run</button>
        ${canShare ? '<button class="btn ghost" id="shareBtn">Copy result</button>' : ''}
        <button class="btn ghost" id="titleBtn">Title screen</button>
      </div>
      <p class="hint">Seed ${stats.seed}</p>
    `);
    this.el.querySelector('#retryBtn').onclick = onRetry;
    this.el.querySelector('#titleBtn').onclick = onTitle;
    if (canShare) {
      const btn = this.el.querySelector('#shareBtn');
      btn.onclick = () => {
        const text = `WizRogue daily ${dailyLabel} — depth ${stats.depth} · ${stats.kills} slain · ${mins}:${secs} · ${stats.archetype}`;
        navigator.clipboard.writeText(text)
          .then(() => { btn.textContent = 'Copied!'; })
          .catch(() => { btn.textContent = 'Copy failed'; });
      };
    }
    this.attachKeys({ Enter: onRetry });
  }
}

// "a Brute", "an Elder Wisp" — but named things like the Warden take "the".
function article(name) {
  if (/warden/i.test(name)) return `the ${name}`;
  if (/^a /i.test(name)) return name; // already phrased, e.g. "a Volatile death-burst"
  return `${/^[aeiou]/i.test(name) ? 'an' : 'a'} ${name}`;
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

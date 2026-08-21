import { SPELLS, SCHOOLS, spellStats } from '../game/spells.js';

const rgb = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;

export class Hud {
  constructor(root = document) {
    this.el = root.getElementById('hud');
    this.depth = root.getElementById('depth');
    this.kills = root.getElementById('kills');
    this.objective = root.getElementById('objective');
    this.log = root.getElementById('log');
    this.slots = root.getElementById('slots');
    this.hp = root.querySelector('.meter.hp');
    this.mp = root.querySelector('.meter.mp');
    this.boss = root.getElementById('bossbar');
    this.bossFill = root.querySelector('#bossbar .track i');
    this.bossName = root.querySelector('#bossbar .boss-name');
    this.crosshair = root.getElementById('crosshair');
    this.signature = '';
    this.logSignature = '';
    this.slotEls = [];
    this.onSlotTap = null;
  }

  show(on) { this.el.hidden = !on; }

  buildSlots(player) {
    this.slots.innerHTML = '';
    this.slotEls = [];
    for (let i = 0; i < 5; i++) {
      const entry = player.slots[i];
      const unlocked = i < player.unlocked;
      const div = document.createElement('div');
      div.className = 'slot' + (unlocked ? '' : ' locked') + (entry ? '' : ' empty');
      const spell = entry ? SPELLS[entry.id] : null;
      const color = spell ? rgb(SCHOOLS[spell.school].color) : '#8a80b0';
      const stats = entry ? spellStats(entry.id, entry.rank, player.mods) : null;
      div.innerHTML = `
        <span class="key">${unlocked ? i + 1 : '🔒'}</span>
        <span class="glyph" style="color:${color}">${spell ? spell.glyph : '·'}</span>
        <span class="name">${spell ? spell.name : (unlocked ? 'empty' : 'locked')}</span>
        <span class="cost">${stats ? (stats.cost > 0 ? stats.cost : '—') : ''}${entry && entry.rank > 1 ? ` · r${entry.rank}` : ''}</span>
        <i class="cd" style="transform:scaleY(0)"></i>`;
      if (unlocked && entry) {
        div.addEventListener('pointerdown', (e) => { e.preventDefault(); this.onSlotTap?.(i); });
      }
      this.slots.appendChild(div);
      this.slotEls.push({ div, cd: div.querySelector('.cd') });
    }
  }

  update(game) {
    const p = game.player;
    const sig = `${p.unlocked}|${p.slots.map((s) => (s ? `${s.id}:${s.rank}` : '-')).join(',')}|${p.mods.cdMul}|${p.mods.costMul}`;
    if (sig !== this.signature) { this.signature = sig; this.buildSlots(p); }

    this.depth.textContent = `Depth ${game.depth}`;
    this.kills.textContent = `${game.runKills} slain`;

    const hpPct = Math.max(0, p.health / p.maxHealth);
    this.hp.classList.toggle('low', hpPct < 0.3);
    this.hp.querySelector('i').style.transform = `scaleX(${hpPct})`;
    this.hp.querySelector('b').textContent = Math.max(0, Math.ceil(p.health));
    const mpPct = Math.max(0, p.mana / p.maxMana);
    this.mp.querySelector('i').style.transform = `scaleX(${mpPct})`;
    this.mp.querySelector('b').textContent = Math.ceil(p.mana);
    const shieldPct = p.shield > 0 ? Math.min(1, p.shield / p.maxHealth) : 0;
    this.mp.querySelector('em').style.transform = `scaleX(${shieldPct})`;

    for (let i = 0; i < 5; i++) {
      const { div, cd } = this.slotEls[i];
      const entry = p.slots[i];
      div.classList.toggle('selected', i === p.selected && !!entry);
      if (!entry) { cd.style.transform = 'scaleY(0)'; continue; }
      const stats = spellStats(entry.id, entry.rank, p.mods);
      const frac = Math.max(0, p.cooldowns[i] / stats.cd);
      cd.style.transform = `scaleY(${frac})`;
      div.classList.toggle('broke', p.mana < stats.cost);
    }

    // hit marker: a brief gold pop on the crosshair whenever a spell connects
    this.crosshair.classList.toggle('hit', game.hitMarker > 0);

    // objective line
    const boss = game.enemies.find((e) => e.type.boss && !e.dead);
    const live = game.level.encounters.find((e) => e.triggered && !e.cleared);
    if (live) {
      const n = game.enemies.filter((e) => e.encounter === live && !e.dead).length;
      const foes = n === 1 ? '1 foe remains' : `${n} foes remain`;
      if (live.kind === 'boss') {
        this.objective.textContent = `The ${boss ? boss.name : 'Warden'} bars the way`;
      } else {
        const where = live.waves > 1 ? `Wave ${live.wave} of ${live.waves}` : 'Sealed';
        this.objective.textContent = live.dark ? `${where}, in the dark — ${foes}` : `${where} — ${foes}`;
      }
    } else {
      this.objective.textContent = game.portalReady === false ? 'The portal is dormant' : 'Descend — find the portal';
    }

    // boss bar
    if (boss && boss.awake) {
      this.boss.hidden = false;
      this.bossName.textContent = boss.name;
      this.bossFill.style.width = `${Math.max(0, (boss.hp / boss.maxHp) * 100)}%`;
    } else {
      this.boss.hidden = true;
    }

    const logSig = game.log.map((l) => l.t).join(',');
    if (logSig !== this.logSignature) {
      this.logSignature = logSig;
      this.log.innerHTML = game.log
        .map((l) => `<div style="color:${l.color}">${l.text}</div>`)
        .join('');
    }
    // Old lines drift away instead of hanging around forever.
    const kids = this.log.children;
    for (let i = 0; i < kids.length && i < game.log.length; i++) {
      const age = game.time - game.log[i].t;
      kids[i].style.opacity = age < 6 ? '' : String(Math.max(0, 0.92 * (1 - (age - 6) / 3)));
    }
  }
}

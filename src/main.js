import { buildTextures } from './render/textures.js';
import { Renderer } from './render/raycaster.js';
import { Game } from './game/game.js';
import { rollRewards } from './game/rewards.js';
import { Input } from './ui/input.js';
import { TouchControls } from './ui/touch.js';
import { Audio } from './ui/audio.js';
import { Hud } from './ui/hud.js';
import { Menus } from './ui/menus.js';
import { settings, loadSettings, loadBest, recordRun, dailySeed } from './settings.js';

class App {
  constructor() {
    loadSettings();
    this.canvas = document.getElementById('view');
    this.fader = document.getElementById('fader');
    this.tex = buildTextures();
    this.audio = new Audio();
    this.input = new Input(this.canvas);
    this.renderer = new Renderer(this.canvas, this.tex);
    this.hud = new Hud(document);
    this.menus = new Menus(document);
    this.mode = 'title';
    this.last = performance.now();
    this.pendingSeed = null;   // set when a daily run was requested
    this.dailyLabel = null;

    this.game = new Game(this.tex, this.audio, {
      onLevelClear: () => this.showRewards(),
      onDeath: (stats) => this.showDeath(stats),
    });

    this.touchUI = new TouchControls(document, this.input, { onPause: () => this.pause() });
    if (this.input.touch) document.body.classList.add('touch');
    document.body.classList.toggle('lefty', settings.lefty);
    this.input.onTouchMode = () => {
      document.body.classList.add('touch');
      this.touchUI.show(this.mode === 'playing');
    };

    this.input.onEscape = () => this.togglePause();
    this.input.onPause = () => { if (this.mode === 'playing') this.pause(); };
    this.hud.onSlotTap = (i) => { if (this.mode === 'playing') this.input.pressSlot(i); };
    this.canvas.addEventListener('click', () => {
      if (this.mode === 'playing') this.input.requestLock();
    });
    window.addEventListener('resize', () => this.renderer.resize(window.innerWidth, window.innerHeight));
    window.addEventListener('blur', () => { if (this.mode === 'playing') this.pause(); });

    this.registerServiceWorker();
    this.showTitle();
    requestAnimationFrame((t) => this.frame(t));
  }

  registerServiceWorker() {
    if ('serviceWorker' in navigator && window.location.protocol.startsWith('http')) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }
  }

  // --- screens ------------------------------------------------------------

  showTitle() {
    this.mode = 'title';
    this.hud.show(false);
    this.input.releaseLock();
    this.menus.title({
      best: loadBest(),
      onStart: () => {
        this.audio.ensure();
        this.pendingSeed = null;
        this.dailyLabel = null;
        this.showSelect();
      },
      onDaily: () => {
        this.audio.ensure();
        const d = dailySeed();
        this.pendingSeed = d.seed;
        this.dailyLabel = d.label;
        this.showSelect();
      },
      onSettings: () => this.showSettings(() => this.showTitle()),
    });
  }

  showSettings(onBack) {
    this.menus.settingsMenu({
      muted: this.audio.muted,
      onToggleMute: () => { this.audio.setMuted(!this.audio.muted); return this.audio.muted; },
      touch: this.input.touch,
      onBack,
    });
  }

  showSelect() {
    this.mode = 'select';
    this.hud.show(false);
    this.menus.archetypes((id) => this.startRun(id), this.dailyLabel);
  }

  startRun(archetypeId) {
    if (this.pendingSeed !== null) this.game.startRun(archetypeId, this.pendingSeed);
    else this.game.startRun(archetypeId);
    this.enterImmersion();
    this.resume();
  }

  // Fullscreen + landscape are best-effort: browsers that refuse just play inline.
  enterImmersion() {
    if (!this.input.touch) return;
    const el = document.documentElement;
    const fs = el.requestFullscreen?.() || el.webkitRequestFullscreen?.();
    if (fs && typeof fs.then === 'function') {
      fs.then(() => screen.orientation?.lock?.('landscape').catch(() => {})).catch(() => {});
    }
  }

  resume() {
    this.mode = 'playing';
    this.game.state = 'playing';
    this.menus.hide();
    this.hud.show(true);
    this.touchUI.show(true);
    this.input.requestLock();
    this.last = performance.now();
  }

  pause() {
    if (this.mode !== 'playing') return;
    this.mode = 'paused';
    this.input.releaseLock();
    this.renderPauseMenu();
  }

  renderPauseMenu() {
    this.menus.pause({
      onResume: () => this.resume(),
      onAbandon: () => this.showTitle(),
      onSettings: () => this.showSettings(() => this.renderPauseMenu()),
      muted: this.audio.muted,
      onToggleMute: () => { this.audio.setMuted(!this.audio.muted); return this.audio.muted; },
    });
  }

  togglePause() {
    if (this.mode === 'playing') this.pause();
    else if (this.mode === 'paused') this.resume();
  }

  showRewards() {
    this.mode = 'reward';
    this.input.releaseLock();
    // A short white-out sells stepping through the portal.
    this.fader.classList.add('on');
    setTimeout(() => {
      const options = rollRewards(this.game);
      const present = () => {
        this.menus.rewards(options, this.game.player, this.game.depth, (choice) => {
          this.game.applyReward(choice);
          this.game.nextDepth();
          this.resume();
        });
        this.menus.rewardsBack = present;
      };
      present();
      this.fader.classList.remove('on');
    }, 420);
  }

  showDeath(stats) {
    this.mode = 'dead';
    this.hud.show(false);
    this.input.releaseLock();
    const isRecord = recordRun(stats);
    this.menus.death(stats, this.game.player, {
      isRecord,
      dailyLabel: this.dailyLabel,
      onRetry: () => this.showSelect(),
      onTitle: () => this.showTitle(),
    });
  }

  // --- loop ---------------------------------------------------------------

  frame(now) {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;

    this.input.pollGamepad(dt);
    if (this.mode === 'playing') {
      this.input.keyboardTurn(dt);
      this.game.update(dt, this.input);
      this.hud.update(this.game);
      if (this.input.touch) this.touchUI.sync(this.game);
    }
    this.input.endFrame();

    if (this.game.level) this.renderer.render(this.game, now / 1000);
    requestAnimationFrame((t) => this.frame(t));
  }
}

window.addEventListener('error', (e) => {
  const el = document.getElementById('overlay');
  if (!el) return;
  el.classList.add('on');
  el.innerHTML = `<div class="screen"><h2 class="section-title">Something broke</h2>
    <p class="section-sub">${e.message}</p></div>`;
});

window.__app = new App();

import { buildTextures } from './render/textures.js';
import { Renderer } from './render/raycaster.js';
import { Game } from './game/game.js';
import { rollRewards } from './game/rewards.js';
import { Input } from './ui/input.js';
import { Audio } from './ui/audio.js';
import { Hud } from './ui/hud.js';
import { Menus } from './ui/menus.js';

class App {
  constructor() {
    this.canvas = document.getElementById('view');
    this.tex = buildTextures();
    this.audio = new Audio();
    this.input = new Input(this.canvas);
    this.renderer = new Renderer(this.canvas, this.tex);
    this.hud = new Hud(document);
    this.menus = new Menus(document);
    this.mode = 'title';
    this.last = performance.now();

    this.game = new Game(this.tex, this.audio, {
      onLevelClear: () => this.showRewards(),
      onDeath: (stats) => this.showDeath(stats),
    });

    this.input.onEscape = () => this.togglePause();
    this.input.onPause = () => { if (this.mode === 'playing') this.pause(); };
    this.canvas.addEventListener('click', () => {
      if (this.mode === 'playing') this.input.requestLock();
    });
    window.addEventListener('resize', () => this.renderer.resize(window.innerWidth, window.innerHeight));
    window.addEventListener('blur', () => { if (this.mode === 'playing') this.pause(); });

    this.showTitle();
    requestAnimationFrame((t) => this.frame(t));
  }

  // --- screens ------------------------------------------------------------

  showTitle() {
    this.mode = 'title';
    this.hud.show(false);
    this.input.releaseLock();
    this.menus.title(() => {
      this.audio.ensure();
      this.showSelect();
    });
  }

  showSelect() {
    this.mode = 'select';
    this.hud.show(false);
    this.menus.archetypes((id) => this.startRun(id));
  }

  startRun(archetypeId) {
    this.game.startRun(archetypeId);
    this.resume();
  }

  resume() {
    this.mode = 'playing';
    this.game.state = 'playing';
    this.menus.hide();
    this.hud.show(true);
    this.input.requestLock();
    this.last = performance.now();
  }

  pause() {
    if (this.mode !== 'playing') return;
    this.mode = 'paused';
    this.input.releaseLock();
    this.menus.pause({
      onResume: () => this.resume(),
      onAbandon: () => this.showTitle(),
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
  }

  showDeath(stats) {
    this.mode = 'dead';
    this.hud.show(false);
    this.input.releaseLock();
    this.menus.death(stats, this.game.player,
      () => this.showSelect(),
      () => this.showTitle());
  }

  // --- loop ---------------------------------------------------------------

  frame(now) {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;

    if (this.mode === 'playing') {
      this.input.keyboardTurn(dt);
      this.game.update(dt, this.input);
      this.hud.update(this.game);
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

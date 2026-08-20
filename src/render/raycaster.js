import { RENDER } from '../config.js';
import { T } from '../world/mapgen.js';
import { clamp } from '../util/rng.js';
import { settings } from '../settings.js';

const FOG = RENDER.fog;
const WHITE = [255, 255, 255];

export class Renderer {
  constructor(canvas, tex) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.tex = tex;
    this.w = 0; this.h = 0;
    this.resize(window.innerWidth, window.innerHeight);
  }

  resize(cssW, cssH) {
    const aspect = clamp(cssW / Math.max(1, cssH), 1.2, 2.6);
    const h = RENDER.height;
    const w = Math.round(clamp(h * aspect, RENDER.minWidth, RENDER.maxWidth));
    if (w === this.w && h === this.h) return;
    this.w = w; this.h = h;
    this.canvas.width = w;
    this.canvas.height = h;
    this.ctx.imageSmoothingEnabled = false;
    this.image = this.ctx.createImageData(w, h);
    this.buf = new Uint32Array(this.image.data.buffer);
    this.zbuf = new Float32Array(w);
  }

  render(game, time) {
    const { w, h } = this;
    const p = game.player;
    const level = game.level;

    const dirX = Math.cos(p.angle), dirY = Math.sin(p.angle);
    const planeLen = Math.tan(RENDER.fov / 2) * (w / h) / (16 / 9);
    const planeX = -dirY * planeLen, planeY = dirX * planeLen;

    // Screen-space horizon: look angle, walk bob and hit shake all live here.
    const shake = settings.shake && p.shake > 0 ? Math.sin(time * 47) * p.shake * 4 : 0;
    const horizon = h * 0.5 + p.pitch * h + p.bob + shake;
    this.cam = { dirX, dirY, planeX, planeY, horizon };

    // Biome grading: the whole scene multiplies through the region's tint and
    // fades into the region's fog, so each depth band has its own cast.
    const biome = game.biome;
    this.fogC = biome ? biome.fog : FOG;
    this.tint = biome ? biome.tint : [1, 1, 1];

    this.drawFloorAndCeiling(level, p, dirX, dirY, planeX, planeY, horizon);
    this.drawWalls(level, p, dirX, dirY, planeX, planeY, horizon, time);
    this.drawSprites(game, p, dirX, dirY, planeX, planeY, horizon, time);

    this.ctx.putImageData(this.image, 0, 0);
    this.drawFloaters(game);
    this.drawHealthBars(game);
    this.drawOverlay(game, time);
  }

  drawFloorAndCeiling(level, p, dirX, dirY, planeX, planeY, horizon) {
    const { w, h, buf } = this;
    const FOG = this.fogC;
    const [t0, t1, t2] = this.tint;
    const floor = this.tex.floor, ceil = this.tex.ceiling;
    const S = floor.size;
    const rx0 = dirX - planeX, ry0 = dirY - planeY;
    const rx1 = dirX + planeX, ry1 = dirY + planeY;
    const posZ = 0.5 * h;

    for (let y = 0; y < h; y++) {
      const isFloor = y > horizon;
      const dist = Math.abs(y - horizon);
      if (dist < 0.5) { // horizon line: fill with fog
        const c = (255 << 24) | (FOG[2] << 16) | (FOG[1] << 8) | FOG[0];
        for (let x = 0; x < w; x++) buf[y * w + x] = c;
        continue;
      }
      const rowDist = posZ / dist;
      if (rowDist > RENDER.viewDistance) {
        const c = (255 << 24) | (FOG[2] << 16) | (FOG[1] << 8) | FOG[0];
        for (let x = 0; x < w; x++) buf[y * w + x] = c;
        continue;
      }
      const stepX = (rowDist * (rx1 - rx0)) / w;
      const stepY = (rowDist * (ry1 - ry0)) / w;
      let fx = p.x + rowDist * rx0;
      let fy = p.y + rowDist * ry0;
      const fogT = rowDist / RENDER.viewDistance;
      const f = 1 - fogT * fogT;
      const tex = isFloor ? floor : ceil;
      const rowBase = y * w;

      for (let x = 0; x < w; x++) {
        const cx = Math.floor(fx), cy = Math.floor(fy);
        const tX = ((fx - cx) * S) & (S - 1);
        const tY = ((fy - cy) * S) & (S - 1);
        const c = tex.pix[tY * S + tX];
        const lit = level.lightAt(cx, cy) * f * (isFloor ? 1 : 0.88);
        const r = ((c & 255) * lit * t0 + FOG[0] * fogT * 0.45) | 0;
        const g = (((c >> 8) & 255) * lit * t1 + FOG[1] * fogT * 0.45) | 0;
        const b = (((c >> 16) & 255) * lit * t2 + FOG[2] * fogT * 0.45) | 0;
        buf[rowBase + x] = (255 << 24) | (b << 16) | (g << 8) | r;
        fx += stepX; fy += stepY;
      }
    }
  }

  drawWalls(level, p, dirX, dirY, planeX, planeY, horizon, time) {
    const { w, h, buf, zbuf } = this;
    const FOG = this.fogC;
    const [t0, t1, t2] = this.tint;
    const barrierFrame = this.tex.barrier[Math.floor(time * 9) % this.tex.barrier.length];

    for (let x = 0; x < w; x++) {
      const camX = (2 * x) / w - 1;
      const rayX = dirX + planeX * camX;
      const rayY = dirY + planeY * camX;
      let mapX = Math.floor(p.x), mapY = Math.floor(p.y);
      const deltaX = Math.abs(1 / (rayX || 1e-9));
      const deltaY = Math.abs(1 / (rayY || 1e-9));
      let stepX, stepY, sideX, sideY;
      if (rayX < 0) { stepX = -1; sideX = (p.x - mapX) * deltaX; }
      else { stepX = 1; sideX = (mapX + 1 - p.x) * deltaX; }
      if (rayY < 0) { stepY = -1; sideY = (p.y - mapY) * deltaY; }
      else { stepY = 1; sideY = (mapY + 1 - p.y) * deltaY; }

      let side = 0, hit = 0, dist = 0, guard = 128;
      while (guard-- > 0) {
        if (sideX < sideY) { sideX += deltaX; mapX += stepX; side = 0; }
        else { sideY += deltaY; mapY += stepY; side = 1; }
        if (level.solid(mapX, mapY)) { hit = 1; break; }
        dist = side === 0 ? sideX - deltaX : sideY - deltaY;
        if (dist > RENDER.viewDistance) break;
      }
      if (!hit) { zbuf[x] = RENDER.viewDistance; continue; }

      const perp = side === 0 ? sideX - deltaX : sideY - deltaY;
      zbuf[x] = perp;
      if (perp > RENDER.viewDistance) continue;

      const tile = level.tileAt(mapX, mapY);
      const tex = tile === T.BARRIER ? barrierFrame : (this.tex.walls[tile] || this.tex.walls[1]);
      const S = tex.size;

      let wallX = side === 0 ? p.y + perp * rayY : p.x + perp * rayX;
      wallX -= Math.floor(wallX);
      let texX = Math.floor(wallX * S);
      if ((side === 0 && rayX > 0) || (side === 1 && rayY < 0)) texX = S - texX - 1;

      const lineH = h / perp;
      const start = horizon - lineH / 2;
      const y0 = Math.max(0, Math.ceil(start));
      const y1 = Math.min(h - 1, Math.floor(start + lineH));
      const texStep = S / lineH;
      let texPos = (y0 - start) * texStep;

      const lit0 = level.lightAt(mapX - (side === 0 ? stepX : 0), mapY - (side === 1 ? stepY : 0));
      const fogT = perp / RENDER.viewDistance;
      const f = 1 - fogT * fogT;
      const lit = lit0 * f * (side === 1 ? 0.72 : 1);
      const litR = lit * t0, litG = lit * t1, litB = lit * t2;
      const fr = FOG[0] * fogT * 0.45, fg = FOG[1] * fogT * 0.45, fb = FOG[2] * fogT * 0.45;

      for (let y = y0; y <= y1; y++) {
        const texY = Math.min(S - 1, texPos | 0);
        texPos += texStep;
        const i = texY * S + texX;
        const c = tex.pix[i];
        const e = tex.emis[i] / 255 * f;
        const cr = c & 255, cg = (c >> 8) & 255, cb = (c >> 16) & 255;
        const r = Math.min(255, cr * litR + cr * e + fr) | 0;
        const g = Math.min(255, cg * litG + cg * e + fg) | 0;
        const b = Math.min(255, cb * litB + cb * e + fb) | 0;
        buf[y * w + x] = (255 << 24) | (b << 16) | (g << 8) | r;
      }
    }
  }

  drawSprites(game, p, dirX, dirY, planeX, planeY, horizon, time) {
    const list = game.collectSprites(time);
    for (const s of list) {
      s.dist = (s.x - p.x) ** 2 + (s.y - p.y) ** 2;
    }
    list.sort((a, b) => b.dist - a.dist);

    const { w, h, buf, zbuf } = this;
    const invDet = 1 / (planeX * dirY - dirX * planeY);

    for (const s of list) {
      const sx = s.x - p.x, sy = s.y - p.y;
      const tx = invDet * (dirY * sx - dirX * sy);
      const ty = invDet * (-planeY * sx + planeX * sy);
      if (ty <= 0.12 || ty > RENDER.viewDistance) continue;

      const scale = h / ty;
      const screenX = (w / 2) * (1 + tx / ty);
      const spriteH = s.h * scale;
      const spriteW = (s.w || s.h) * scale;
      const yCenter = horizon + (0.5 - s.z) * scale;
      const left = screenX - spriteW / 2;
      const top = yCenter - spriteH / 2;
      const x0 = Math.max(0, Math.floor(left));
      const x1 = Math.min(w - 1, Math.ceil(left + spriteW));
      const y0 = Math.max(0, Math.floor(top));
      const y1 = Math.min(h - 1, Math.ceil(top + spriteH));
      if (x1 < x0 || y1 < y0) continue;

      const tex = s.tex;
      const S = tex.size;
      const fogT = ty / RENDER.viewDistance;
      const fade = 1 - fogT * fogT;
      const ambientFloor = s.creature ? 0.62 : 0.25;
      const lit = s.additive
        ? fade
        : Math.min(1.4, Math.max(ambientFloor, game.level.lightAt(Math.floor(s.x), Math.floor(s.y)) + 0.3)) * fade;
      const alpha = (s.alpha === undefined ? 1 : s.alpha);
      const tint = s.tint;
      const flash = s.flash || 0;
      const flashC = s.flashColor || WHITE;

      for (let x = x0; x <= x1; x++) {
        if (ty >= zbuf[x]) continue;
        const texX = Math.min(S - 1, Math.max(0, ((x + 0.5 - left) / spriteW * S) | 0));
        for (let y = y0; y <= y1; y++) {
          const texY = Math.min(S - 1, Math.max(0, ((y + 0.5 - top) / spriteH * S) | 0));
          const c = tex.pix[texY * S + texX];
          const a = (c >>> 24) / 255 * alpha;
          if (a < 0.02) continue;
          let sr = (c & 255) * lit, sg = ((c >> 8) & 255) * lit, sb = ((c >> 16) & 255) * lit;
          if (tint) { sr *= tint[0] / 255; sg *= tint[1] / 255; sb *= tint[2] / 255; }
          if (flash) {
            sr += (flashC[0] - sr) * flash;
            sg += (flashC[1] - sg) * flash;
            sb += (flashC[2] - sb) * flash;
          }
          const di = y * w + x;
          const d = buf[di];
          const dr = d & 255, dg = (d >> 8) & 255, db = (d >> 16) & 255;
          let r, g, b;
          if (s.additive) {
            r = dr + sr * a; g = dg + sg * a; b = db + sb * a;
          } else {
            r = dr + (sr - dr) * a; g = dg + (sg - dg) * a; b = db + (sb - db) * a;
          }
          buf[di] = (255 << 24) |
            ((b > 255 ? 255 : b) << 16) | ((g > 255 ? 255 : g) << 8) | (r > 255 ? 255 : r);
        }
      }
    }
  }

  // Floating damage numbers, projected the same way sprites are but drawn as
  // text with the 2D context after the pixel buffer lands.
  drawFloaters(game) {
    const list = game.floaters;
    if (!list || !list.length) return;
    const { w, h, ctx, cam, zbuf } = this;
    const p = game.player;
    const invDet = 1 / (cam.planeX * cam.dirY - cam.dirX * cam.planeY);
    ctx.textAlign = 'center';

    for (const f of list) {
      const sx = f.x - p.x, sy = f.y - p.y;
      const tx = invDet * (cam.dirY * sx - cam.dirX * sy);
      const ty = invDet * (-cam.planeY * sx + cam.planeX * sy);
      if (ty <= 0.25 || ty > RENDER.viewDistance * 0.8) continue;

      const scale = h / ty;
      const screenX = (w / 2) * (1 + tx / ty);
      const screenY = cam.horizon + (0.5 - f.z) * scale;
      if (screenX < -20 || screenX > w + 20 || screenY < -10 || screenY > h + 10) continue;
      const col = Math.max(0, Math.min(w - 1, Math.round(screenX)));
      if (ty >= zbuf[col] + 0.4) continue; // behind a wall

      const k = f.t / f.life;
      const alpha = k < 0.15 ? k / 0.15 : 1 - Math.max(0, (k - 0.55) / 0.45);
      const px = Math.round(clamp(11 / ty * 2.4, 6, 13));
      const c = f.color;
      ctx.font = `bold ${px}px ${'ui-monospace, Menlo, monospace'}`;
      ctx.globalAlpha = Math.max(0, alpha);
      ctx.fillStyle = '#08040f';
      ctx.fillText(String(Math.round(f.value)), screenX + 1, screenY + 1);
      ctx.fillStyle = `rgb(${Math.min(255, c[0] + 70)},${Math.min(255, c[1] + 70)},${Math.min(255, c[2] + 70)})`;
      ctx.fillText(String(Math.round(f.value)), screenX, screenY);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'start';
  }

  // A sliver of health floats over any enemy hurt in the last moment or two.
  // Bosses are exempt — they own the big bar at the top of the screen.
  drawHealthBars(game) {
    const enemies = game.enemies;
    if (!enemies || !enemies.length) return;
    const { w, h, ctx, cam, zbuf } = this;
    const p = game.player;
    const invDet = 1 / (cam.planeX * cam.dirY - cam.dirX * cam.planeY);

    for (const e of enemies) {
      if (e.dead || e.type.boss || e.hpBarTime <= 0 || e.hp >= e.maxHp) continue;
      const sx = e.x - p.x, sy = e.y - p.y;
      const tx = invDet * (cam.dirY * sx - cam.dirX * sy);
      const ty = invDet * (-cam.planeY * sx + cam.planeX * sy);
      if (ty <= 0.3 || ty > RENDER.viewDistance * 0.7) continue;

      const scale = h / ty;
      const screenX = (w / 2) * (1 + tx / ty);
      const screenY = cam.horizon + (0.5 - (e.z + e.height * 0.62)) * scale;
      if (screenX < -30 || screenX > w + 30 || screenY < -8 || screenY > h + 8) continue;
      const col = Math.max(0, Math.min(w - 1, Math.round(screenX)));
      if (ty >= zbuf[col] + 0.4) continue; // behind a wall

      const bw = clamp(scale * e.radius * 1.7, 12, 44);
      const bh = Math.max(2, Math.round(scale * 0.02) + 2);
      const frac = Math.max(0, e.hp / e.maxHp);
      ctx.globalAlpha = Math.min(1, e.hpBarTime / 0.4) * 0.9;
      ctx.fillStyle = 'rgba(6,4,14,0.85)';
      ctx.fillRect(screenX - bw / 2 - 1, screenY - 1, bw + 2, bh + 2);
      ctx.fillStyle = e.elite ? '#ffd76a' : (frac > 0.45 ? '#8affc4' : '#ff5a78');
      ctx.fillRect(screenX - bw / 2, screenY, bw * frac, bh);
    }
    ctx.globalAlpha = 1;
  }

  // Hands, flashes and vignette are cheaper to draw with the 2D context.
  drawOverlay(game, time) {
    const ctx = this.ctx;
    const { w, h } = this;
    const p = game.player;

    this.drawHands(ctx, game, time);

    if (p.castFlash > 0) {
      const c = p.castColor;
      ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${p.castFlash * 0.16})`;
      ctx.fillRect(0, 0, w, h);
    }
    if (p.hurtFlash > 0) {
      // Edge-hugging, so a hit reads as damage without blinding the player.
      const g = ctx.createRadialGradient(w / 2, h / 2, h * 0.5, w / 2, h / 2, h * 1.05);
      g.addColorStop(0, 'rgba(150,0,20,0)');
      g.addColorStop(0.6, `rgba(175,10,30,${Math.min(0.4, p.hurtFlash * 0.45)})`);
      g.addColorStop(1, `rgba(200,15,35,${Math.min(0.72, p.hurtFlash * 0.85)})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
    const lowHp = 1 - p.health / p.maxHealth;
    if (lowHp > 0.65) {
      const pulse = (Math.sin(time * 4) * 0.5 + 0.5) * (lowHp - 0.65) * 1.4;
      const g = ctx.createRadialGradient(w / 2, h / 2, h * 0.35, w / 2, h / 2, h * 1.0);
      g.addColorStop(0, 'rgba(120,0,20,0)');
      g.addColorStop(1, `rgba(130,0,22,${Math.min(0.6, pulse * 0.85)})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
    if (!this.vignette) {
      const g = ctx.createRadialGradient(w / 2, h / 2, h * 0.35, w / 2, h / 2, h * 0.95);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,0,0.55)');
      this.vignette = g;
    }
    ctx.fillStyle = this.vignette;
    ctx.fillRect(0, 0, w, h);
  }

  drawHands(ctx, game, time) {
    const { w, h } = this;
    const p = game.player;
    const stats = p.statsFor(p.selected);
    const color = game.selectedColor();
    const cd = p.cooldowns[p.selected];
    const ready = stats && cd <= 0 && p.mana >= stats.cost;
    const s = h / 118;
    const bob = Math.sin(p.bobPhase) * 2.6;
    const bob2 = Math.cos(p.bobPhase * 2) * 1.4;
    const kick = p.castFlash * 7;

    for (const side of [-1, 1]) {
      const baseX = w / 2 + side * w * 0.2;
      const baseY = h + (10 + kick + (side > 0 ? bob : -bob) + bob2) * s * 0.5;
      ctx.save();
      ctx.translate(baseX, baseY);
      ctx.scale(side * s, s);
      ctx.rotate(-0.26);

      // forearm and robe sleeve
      const sleeve = ctx.createLinearGradient(0, -14, 0, 26);
      sleeve.addColorStop(0, '#3b2c56');
      sleeve.addColorStop(1, '#1a1229');
      ctx.fillStyle = sleeve;
      ctx.beginPath();
      ctx.moveTo(-9, 30);
      ctx.lineTo(10, 30);
      ctx.lineTo(6.5, -6);
      ctx.lineTo(-6, -4);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.45)';
      ctx.lineWidth = 0.8;
      ctx.stroke();

      // cuff in the archetype colour
      ctx.fillStyle = p.archetype.accent;
      ctx.globalAlpha = 0.55;
      ctx.beginPath();
      ctx.moveTo(-6.4, -1); ctx.lineTo(6.8, -3); ctx.lineTo(7.2, 1.4); ctx.lineTo(-6.6, 3.2);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;

      // hand, cupped toward the centre of the screen
      ctx.fillStyle = '#b98d68';
      ctx.beginPath();
      ctx.ellipse(-0.5, -9, 5.6, 6.4, -0.15, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#a87c5c';
      for (let f = 0; f < 3; f++) {
        ctx.beginPath();
        ctx.ellipse(-4.6 + f * 3.4, -13.4 - f * 0.5, 1.5, 3.1, -0.3 + f * 0.16, 0, Math.PI * 2);
        ctx.fill();
      }

      // charge held in the palm
      if (stats) {
        const pulse = 0.6 + Math.sin(time * 6 + side) * 0.16 + p.castFlash * 0.55;
        const rad = (ready ? 9.5 : 5) * pulse;
        const g = ctx.createRadialGradient(-0.5, -13, 0, -0.5, -13, Math.max(1.5, rad));
        g.addColorStop(0, `rgba(255,255,255,${ready ? 0.95 : 0.45})`);
        g.addColorStop(0.4, `rgba(${color[0]},${color[1]},${color[2]},${ready ? 0.85 : 0.3})`);
        g.addColorStop(1, `rgba(${color[0]},${color[1]},${color[2]},0)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(-0.5, -13, Math.max(1.5, rad), 0, Math.PI * 2);
        ctx.fill();
        if (ready) {
          ctx.strokeStyle = `rgba(${color[0]},${color[1]},${color[2]},0.5)`;
          ctx.lineWidth = 0.7;
          ctx.beginPath();
          ctx.arc(-0.5, -13, 6 + Math.sin(time * 3 + side) * 0.8, 0, Math.PI * 2);
          ctx.stroke();
          // Three motes orbiting the charge make "ready" legible at a glance.
          for (let m = 0; m < 3; m++) {
            const oa = time * 2.6 * side + m * 2.094;
            const or = 7.5 + Math.sin(time * 5 + m) * 1.2;
            const ox = -0.5 + Math.cos(oa) * or;
            const oy = -13 + Math.sin(oa) * or * 0.55;
            ctx.fillStyle = `rgba(${color[0]},${color[1]},${color[2]},${0.55 + Math.sin(time * 7 + m) * 0.25})`;
            ctx.beginPath();
            ctx.arc(ox, oy, 0.9, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
      ctx.restore();
    }
  }
}

// Every texture in the game is generated at boot: wall surfaces by arithmetic,
// creature sprites by drawing into an offscreen canvas. No external assets.

export const TEX_SIZE = 64;

const pack = (r, g, b, a = 255) =>
  ((a & 255) << 24) | ((b & 255) << 16) | ((g & 255) << 8) | (r & 255);

// Deterministic value noise so textures look the same every run.
function hash2(x, y) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function noise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
}
function fbm(x, y) {
  return noise(x, y) * 0.55 + noise(x * 2.1, y * 2.1) * 0.28 + noise(x * 4.3, y * 4.3) * 0.17;
}

function blankTex(size = TEX_SIZE) {
  return { size, pix: new Uint32Array(size * size), emis: new Uint8Array(size * size) };
}

function stoneTex(base, veinTint) {
  const t = blankTex();
  const S = TEX_SIZE;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const n = fbm(x * 0.14, y * 0.14);
      const grit = hash2(x * 3 + 1, y * 7 + 5) * 0.14;
      // Rough block courses, chiselled edges.
      const course = Math.floor(y / 16);
      const off = (course % 2) * 12;
      const bx = ((x + off) % 21) / 21;
      const by = (y % 16) / 16;
      const edge = Math.min(bx, 1 - bx, by, 1 - by);
      const groove = edge < 0.06 ? 0.55 : 1;
      const shade = (0.62 + n * 0.55 + grit) * groove;
      const vein = Math.max(0, fbm(x * 0.05 + 9, y * 0.05) - 0.62) * 3;
      const r = Math.min(255, base[0] * shade + veinTint[0] * vein);
      const g = Math.min(255, base[1] * shade + veinTint[1] * vein);
      const b = Math.min(255, base[2] * shade + veinTint[2] * vein);
      t.pix[y * S + x] = pack(r, g, b);
    }
  }
  return t;
}

function brickTex() {
  const t = blankTex();
  const S = TEX_SIZE;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const row = Math.floor(y / 8);
      const off = (row % 2) * 8;
      const bx = ((x + off) % 16), by = y % 8;
      const mortar = bx < 1.5 || by < 1.5;
      const n = fbm(x * 0.2, y * 0.2);
      let r, g, b;
      if (mortar) { r = 42 + n * 22; g = 40 + n * 20; b = 48 + n * 24; }
      else {
        const tone = 0.75 + hash2(row, Math.floor((x + off) / 16)) * 0.4;
        r = (96 + n * 46) * tone; g = (78 + n * 38) * tone; b = (86 + n * 44) * tone;
      }
      t.pix[y * S + x] = pack(r, g, b);
    }
  }
  return t;
}

function runeTex() {
  const t = brickTex();
  const S = TEX_SIZE;
  // Carve a glowing sigil into the brickwork.
  const strokes = [
    [32, 20, 32, 44], [32, 20, 26, 27], [32, 20, 38, 27],
    [26, 34, 38, 34], [28, 44, 36, 44], [24, 26, 24, 38], [40, 26, 40, 38],
  ];
  for (const [x0, y0, x1, y1] of strokes) {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 3;
    for (let i = 0; i <= steps; i++) {
      const px = Math.round(x0 + (x1 - x0) * (i / steps));
      const py = Math.round(y0 + (y1 - y0) * (i / steps));
      for (let oy = 0; oy <= 1; oy++) {
        for (let ox = 0; ox <= 1; ox++) {
          const gx = px + ox, gy = py + oy;
          if (gx < 0 || gy < 0 || gx >= S || gy >= S) continue;
          const core = ox === 0 && oy === 0;
          const i2 = gy * S + gx;
          t.pix[i2] = pack(core ? 190 : 110, core ? 240 : 170, 255);
          t.emis[i2] = Math.max(t.emis[i2], core ? 255 : 150);
        }
      }
    }
  }
  return t;
}

function barrierFrames(count = 6) {
  const frames = [];
  const S = TEX_SIZE;
  for (let f = 0; f < count; f++) {
    const t = blankTex();
    const scroll = (f / count) * S;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        // Vertical filaments drifting upward, with brighter nodes where they cross.
        const fil = Math.pow(Math.abs(Math.sin(x * 0.42 + Math.sin((y + scroll) * 0.08) * 0.9)), 6);
        const drift = noise(x * 0.18, (y + scroll * 2) * 0.09);
        const pulse = 0.5 + 0.5 * Math.sin(((y + scroll * 3) * 0.16));
        const core = fil * (0.55 + drift * 0.9);
        const v = 0.22 + core * 1.5 + pulse * 0.16 + drift * 0.2;
        const r = 60 * v + core * 150;
        const g = 170 * v + core * 110;
        const b = 235 * v + core * 60;
        t.pix[y * S + x] = pack(Math.min(255, r), Math.min(255, g), Math.min(255, b));
        t.emis[y * S + x] = Math.min(255, v * 210 + core * 90);
      }
    }
    frames.push(t);
  }
  return frames;
}

function floorTex() {
  const t = blankTex();
  const S = TEX_SIZE;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const cx = Math.floor(x / 16), cy = Math.floor(y / 16);
      const jitter = hash2(cx, cy);
      const lx = (x % 16) / 16, ly = (y % 16) / 16;
      const edge = Math.min(lx, 1 - lx, ly, 1 - ly);
      const n = fbm(x * 0.2, y * 0.2);
      const v = (edge < 0.06 ? 0.6 : 0.78 + jitter * 0.28) * (0.8 + n * 0.4);
      t.pix[y * S + x] = pack(70 * v + 12, 66 * v + 12, 82 * v + 16);
    }
  }
  return t;
}

function ceilingTex() {
  const t = blankTex();
  const S = TEX_SIZE;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const n = fbm(x * 0.09, y * 0.09);
      const v = 0.45 + n * 0.75;
      t.pix[y * S + x] = pack(48 * v + 10, 44 * v + 10, 70 * v + 16);
    }
  }
  return t;
}

// --- sprite generation --------------------------------------------------

function makeCtx(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = false;
  return ctx;
}

function toTex(ctx) {
  const { width: w, height: h } = ctx.canvas;
  const data = ctx.getImageData(0, 0, w, h);
  return { size: w, w, h, pix: new Uint32Array(data.data.buffer.slice(0)), emis: new Uint8Array(w * h) };
}

const rgba = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

function glowSprite(size, color) {
  const ctx = makeCtx(size, size);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, rgba([255, 255, 255], 1));
  g.addColorStop(0.35, rgba(color, 0.85));
  g.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return toTex(ctx);
}

function crawlerSprite(frame) {
  const S = 48;
  const ctx = makeCtx(S, S);
  const t = frame / 3 * Math.PI * 2;
  ctx.strokeStyle = '#241a2e';
  ctx.lineWidth = 3;
  for (let i = 0; i < 3; i++) {
    for (const dir of [-1, 1]) {
      const lift = Math.sin(t + i * 1.4 + (dir > 0 ? 0.9 : 0)) * 3;
      ctx.beginPath();
      ctx.moveTo(S / 2, 30 + i * 3);
      ctx.lineTo(S / 2 + dir * (10 + i * 2), 34 + i * 2 - lift);
      ctx.lineTo(S / 2 + dir * (14 + i * 2), 44 - lift * 0.5);
      ctx.stroke();
    }
  }
  const body = ctx.createLinearGradient(0, 16, 0, 42);
  body.addColorStop(0, '#5b3f6e');
  body.addColorStop(1, '#2a1c38');
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.ellipse(S / 2, 32, 12, 10, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#3a2850';
  ctx.beginPath();
  ctx.ellipse(S / 2, 22, 8, 7, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ff5a3c';
  for (const dx of [-3.5, 3.5]) {
    ctx.beginPath();
    ctx.arc(S / 2 + dx, 21, 2.1, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = '#8d6bb0';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(S / 2 - 6, 16); ctx.lineTo(S / 2 - 9, 9);
  ctx.moveTo(S / 2 + 6, 16); ctx.lineTo(S / 2 + 9, 9);
  ctx.stroke();
  return toTex(ctx);
}

function wispSprite(frame) {
  const S = 48;
  const ctx = makeCtx(S, S);
  const t = frame / 3 * Math.PI * 2;
  const g = ctx.createRadialGradient(S / 2, S / 2, 1, S / 2, S / 2, 18);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.3, '#c7a6ff');
  g.addColorStop(0.7, 'rgba(120,80,220,0.55)');
  g.addColorStop(1, 'rgba(80,40,180,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(S / 2, S / 2, 18, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(200,170,255,0.75)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 4; i++) {
    const a = t + (i / 4) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(S / 2 + Math.cos(a) * 8, S / 2 + Math.sin(a) * 8);
    ctx.quadraticCurveTo(
      S / 2 + Math.cos(a) * 16, S / 2 + Math.sin(a) * 16 + 4,
      S / 2 + Math.cos(a + 0.6) * 20, S / 2 + Math.sin(a + 0.6) * 20 + 8,
    );
    ctx.stroke();
  }
  ctx.fillStyle = '#1a0f2e';
  ctx.beginPath();
  ctx.ellipse(S / 2, S / 2 - 1, 4, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  return toTex(ctx);
}

function bruteSprite(frame) {
  const S = 56;
  const ctx = makeCtx(S, S);
  const lean = Math.sin(frame / 3 * Math.PI * 2) * 2;
  ctx.fillStyle = '#3c3348';
  ctx.fillRect(S / 2 - 13, 44, 9, 12);
  ctx.fillRect(S / 2 + 4, 44, 9, 12);
  const g = ctx.createLinearGradient(0, 12, 0, 48);
  g.addColorStop(0, '#6b6076');
  g.addColorStop(1, '#332b40');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(S / 2 - 17 + lean, 20);
  ctx.lineTo(S / 2 + 17 + lean, 20);
  ctx.lineTo(S / 2 + 14, 48);
  ctx.lineTo(S / 2 - 14, 48);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#4a4056';
  ctx.beginPath();
  ctx.arc(S / 2 - 19 + lean, 26, 7, 0, Math.PI * 2);
  ctx.arc(S / 2 + 19 + lean, 26, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#5a4f66';
  ctx.beginPath();
  ctx.ellipse(S / 2 + lean, 14, 9, 8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffcf5a';
  ctx.fillRect(S / 2 - 6 + lean, 12, 4, 3);
  ctx.fillRect(S / 2 + 2 + lean, 12, 4, 3);
  ctx.strokeStyle = '#20182c';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(S / 2 - 12, 30); ctx.lineTo(S / 2 + 12, 34);
  ctx.stroke();
  return toTex(ctx);
}

function sentinelSprite(frame) {
  const S = 48;
  const ctx = makeCtx(S, S);
  const open = frame === 0 ? 1 : 0.55;
  ctx.fillStyle = '#443a52';
  ctx.beginPath();
  ctx.moveTo(S / 2 - 16, 24);
  ctx.lineTo(S / 2, 8);
  ctx.lineTo(S / 2 + 16, 24);
  ctx.lineTo(S / 2, 40);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#6f5f84';
  ctx.lineWidth = 2;
  ctx.stroke();
  const g = ctx.createRadialGradient(S / 2, 24, 1, S / 2, 24, 10 * open);
  g.addColorStop(0, '#fff2c4');
  g.addColorStop(0.4, '#ffa63c');
  g.addColorStop(1, 'rgba(255,110,40,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(S / 2, 24, 10 * open, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#1c1426';
  ctx.beginPath();
  ctx.ellipse(S / 2, 24, 2.4, 5 * open, 0, 0, Math.PI * 2);
  ctx.fill();
  return toTex(ctx);
}

function warlockSprite(frame) {
  const S = 56;
  const ctx = makeCtx(S, S);
  const t = frame / 3 * Math.PI * 2;
  const sway = Math.sin(t) * 2;
  const g = ctx.createLinearGradient(0, 14, 0, 52);
  g.addColorStop(0, '#4a2f6e');
  g.addColorStop(1, '#1b1029');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(S / 2 + sway, 12);
  ctx.lineTo(S / 2 + 14, 52);
  ctx.lineTo(S / 2 - 14, 52);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#2a1a3f';
  ctx.beginPath();
  ctx.ellipse(S / 2 + sway, 16, 8, 9, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#0d0616';
  ctx.beginPath();
  ctx.ellipse(S / 2 + sway, 18, 5.5, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#c47bff';
  ctx.beginPath();
  ctx.arc(S / 2 - 2 + sway, 18, 1.8, 0, Math.PI * 2);
  ctx.arc(S / 2 + 2 + sway, 18, 1.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#6b4a2c';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(S / 2 + 13, 22); ctx.lineTo(S / 2 + 16, 50);
  ctx.stroke();
  const og = ctx.createRadialGradient(S / 2 + 13, 20, 0, S / 2 + 13, 20, 8);
  og.addColorStop(0, '#ffffff');
  og.addColorStop(0.4, '#bf6bff');
  og.addColorStop(1, 'rgba(140,60,255,0)');
  ctx.fillStyle = og;
  ctx.beginPath();
  ctx.arc(S / 2 + 13, 20, 8, 0, Math.PI * 2);
  ctx.fill();
  return toTex(ctx);
}

function wardenSprite(frame) {
  const S = 72;
  const ctx = makeCtx(S, S);
  const t = (frame / 3) * Math.PI * 2;
  const sway = Math.sin(t) * 2;
  const cx = S / 2 + sway;

  // legs
  ctx.fillStyle = '#1d1524';
  ctx.beginPath();
  ctx.moveTo(cx - 15, 52); ctx.lineTo(cx - 5, 52); ctx.lineTo(cx - 4, 70); ctx.lineTo(cx - 16, 70);
  ctx.closePath(); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx + 5, 52); ctx.lineTo(cx + 15, 52); ctx.lineTo(cx + 16, 70); ctx.lineTo(cx + 4, 70);
  ctx.closePath(); ctx.fill();

  // torso plate
  const g = ctx.createLinearGradient(0, 20, 0, 56);
  g.addColorStop(0, '#57283e');
  g.addColorStop(0.55, '#33182a');
  g.addColorStop(1, '#1a0e1c');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(cx - 16, 24);
  ctx.lineTo(cx + 16, 24);
  ctx.lineTo(cx + 20, 40);
  ctx.lineTo(cx + 13, 56);
  ctx.lineTo(cx - 13, 56);
  ctx.lineTo(cx - 20, 40);
  ctx.closePath();
  ctx.fill();

  // pauldrons
  ctx.fillStyle = '#4a2136';
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(cx + side * 15, 22);
    ctx.quadraticCurveTo(cx + side * 32, 24, cx + side * 27, 40);
    ctx.quadraticCurveTo(cx + side * 20, 34, cx + side * 15, 34);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#7d3d55';
    ctx.lineWidth = 1.4;
    ctx.stroke();
    // gauntlets hanging below the pauldrons
    ctx.fillStyle = '#2b1624';
    ctx.beginPath();
    ctx.ellipse(cx + side * 25, 48, 5.5, 8, side * 0.25, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#4a2136';
  }

  // ribbed armour lines
  ctx.strokeStyle = 'rgba(140,70,95,0.55)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.moveTo(cx - 13 + i, 34 + i * 6);
    ctx.lineTo(cx + 13 - i, 34 + i * 6);
    ctx.stroke();
  }

  // helm
  ctx.fillStyle = '#2e1826';
  ctx.beginPath();
  ctx.moveTo(cx - 10, 22);
  ctx.lineTo(cx - 8, 8);
  ctx.lineTo(cx + 8, 8);
  ctx.lineTo(cx + 10, 22);
  ctx.closePath();
  ctx.fill();

  // horns
  ctx.strokeStyle = '#e4d0ae';
  ctx.lineWidth = 3.2;
  ctx.lineCap = 'round';
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(cx + side * 8, 12);
    ctx.quadraticCurveTo(cx + side * 22, 6, cx + side * 20, -6);
    ctx.stroke();
  }
  ctx.lineCap = 'butt';

  // visor slit
  const eg = ctx.createLinearGradient(cx - 8, 0, cx + 8, 0);
  eg.addColorStop(0, 'rgba(255,60,90,0.2)');
  eg.addColorStop(0.5, 'rgba(255,235,235,1)');
  eg.addColorStop(1, 'rgba(255,60,90,0.2)');
  ctx.fillStyle = eg;
  ctx.fillRect(cx - 8, 15, 16, 3.4);
  const halo = ctx.createRadialGradient(cx, 16.5, 0, cx, 16.5, 13);
  halo.addColorStop(0, 'rgba(255,80,110,0.55)');
  halo.addColorStop(1, 'rgba(255,40,80,0)');
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(cx, 16.5, 13, 0, Math.PI * 2);
  ctx.fill();

  // furnace in the chest
  const cgl = ctx.createRadialGradient(cx, 40, 0, cx, 40, 8);
  cgl.addColorStop(0, 'rgba(255,225,160,0.95)');
  cgl.addColorStop(0.45, 'rgba(255,140,60,0.5)');
  cgl.addColorStop(1, 'rgba(255,90,40,0)');
  ctx.fillStyle = cgl;
  ctx.beginPath();
  ctx.arc(cx, 40, 8, 0, Math.PI * 2);
  ctx.fill();
  return toTex(ctx);
}

function portalSprite(frame) {
  const S = 64;
  const ctx = makeCtx(S, S);
  const t = frame / 4 * Math.PI * 2;
  for (let i = 5; i >= 0; i--) {
    const r = 8 + i * 4.4;
    const a = 0.13 + Math.sin(t + i * 0.8) * 0.07;
    ctx.strokeStyle = `rgba(${120 + i * 18},${220 - i * 12},255,${a + 0.16})`;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.ellipse(S / 2, S / 2, r * 0.72, r, Math.sin(t * 0.5 + i) * 0.2, 0, Math.PI * 2);
    ctx.stroke();
  }
  const g = ctx.createRadialGradient(S / 2, S / 2, 1, S / 2, S / 2, 22);
  g.addColorStop(0, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.35, 'rgba(120,230,255,0.6)');
  g.addColorStop(1, 'rgba(60,120,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(S / 2, S / 2, 16, 24, 0, 0, Math.PI * 2);
  ctx.fill();
  return toTex(ctx);
}

function pickupSprite(kind) {
  const S = 32;
  const ctx = makeCtx(S, S);
  const color = kind === 'health' ? [255, 90, 120] : [110, 190, 255];
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, 15);
  g.addColorStop(0, rgba(color, 0.9));
  g.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = rgba(color, 1);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(S / 2, 6); ctx.lineTo(S / 2 + 6, S / 2); ctx.lineTo(S / 2, S - 6); ctx.lineTo(S / 2 - 6, S / 2);
  ctx.closePath();
  ctx.globalAlpha = 0.85;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.stroke();
  return toTex(ctx);
}

function torchSprite(frame) {
  const S = 48;
  const ctx = makeCtx(S, S);
  const t = (frame / 3) * Math.PI * 2;
  const cx = S / 2;

  // iron bracket and haft
  ctx.strokeStyle = '#2c2029';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cx, 44); ctx.lineTo(cx, 28);
  ctx.stroke();
  ctx.fillStyle = '#3a2b33';
  ctx.beginPath();
  ctx.moveTo(cx - 5, 30); ctx.lineTo(cx + 5, 30); ctx.lineTo(cx + 3, 24); ctx.lineTo(cx - 3, 24);
  ctx.closePath();
  ctx.fill();

  // outer flame body
  const flick = Math.sin(t) * 1.6;
  const tip = 4 - Math.sin(t * 1.3) * 2;
  const outer = ctx.createLinearGradient(0, tip, 0, 28);
  outer.addColorStop(0, 'rgba(255,120,30,0.0)');
  outer.addColorStop(0.25, 'rgba(255,150,50,0.55)');
  outer.addColorStop(0.7, 'rgba(255,200,110,0.85)');
  outer.addColorStop(1, 'rgba(255,120,40,0.5)');
  ctx.fillStyle = outer;
  ctx.beginPath();
  ctx.moveTo(cx + flick * 0.6, tip);
  ctx.bezierCurveTo(cx + 9, 12, cx + 8, 24, cx, 27);
  ctx.bezierCurveTo(cx - 8, 24, cx - 9, 12, cx + flick * 0.6, tip);
  ctx.fill();

  // white-hot core
  const core = ctx.createLinearGradient(0, 10, 0, 26);
  core.addColorStop(0, 'rgba(255,250,220,0.95)');
  core.addColorStop(1, 'rgba(255,190,90,0.5)');
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.moveTo(cx + flick * 0.4, 10 - Math.sin(t) * 1.5);
  ctx.bezierCurveTo(cx + 4.5, 17, cx + 4, 24, cx, 25.5);
  ctx.bezierCurveTo(cx - 4, 24, cx - 4.5, 17, cx + flick * 0.4, 10 - Math.sin(t) * 1.5);
  ctx.fill();

  // halo so the light bleeds into the corridor
  const halo = ctx.createRadialGradient(cx, 18, 2, cx, 18, 22);
  halo.addColorStop(0, 'rgba(255,190,110,0.35)');
  halo.addColorStop(1, 'rgba(255,120,40,0)');
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, S, S);
  return toTex(ctx);
}

export function buildTextures() {
  return {
    walls: {
      1: stoneTex([104, 100, 124], [70, 130, 170]),
      2: brickTex(),
      3: runeTex(),
    },
    barrier: barrierFrames(),
    floor: floorTex(),
    ceiling: ceilingTex(),
    glow: glowSprite(32, [255, 255, 255]),
    sprites: {
      crawler: [crawlerSprite(0), crawlerSprite(1), crawlerSprite(2)],
      wisp: [wispSprite(0), wispSprite(1), wispSprite(2)],
      brute: [bruteSprite(0), bruteSprite(1), bruteSprite(2)],
      sentinel: [sentinelSprite(0), sentinelSprite(1)],
      warlock: [warlockSprite(0), warlockSprite(1), warlockSprite(2)],
      warden: [wardenSprite(0), wardenSprite(1), wardenSprite(2)],
      portal: [portalSprite(0), portalSprite(1), portalSprite(2), portalSprite(3)],
      health: [pickupSprite('health')],
      mana: [pickupSprite('mana')],
      torch: [torchSprite(0), torchSprite(1), torchSprite(2)],
    },
  };
}

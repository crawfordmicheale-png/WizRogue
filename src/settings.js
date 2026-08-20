// Player preferences, persisted across runs. This module must stay loadable in
// Node (the headless sim imports game code), so storage access is guarded.

const KEY = 'wizrogue.settings';

export const settings = {
  sens: 1,          // look sensitivity multiplier, 0.4–2
  shake: true,      // screen shake on hits and blasts
  haptics: true,    // vibration on phones
  aimAssist: true,  // gentle magnetism on touch and gamepad
  lefty: false,     // mirrored touch layout
};

const hasStorage = typeof localStorage !== 'undefined';

export function loadSettings() {
  if (!hasStorage) return settings;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      for (const k of Object.keys(settings)) {
        if (k in saved) settings[k] = saved[k];
      }
    }
  } catch { /* corrupted storage is not worth crashing over */ }
  settings.sens = Math.min(2, Math.max(0.4, Number(settings.sens) || 1));
  return settings;
}

export function saveSettings() {
  if (!hasStorage) return;
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* quota */ }
}

// --- run records -----------------------------------------------------------

const BEST_KEY = 'wizrogue.best';

export function loadBest() {
  if (!hasStorage) return null;
  try {
    const raw = localStorage.getItem(BEST_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

/** Records the run if it beats the stored best. Returns true on a new record. */
export function recordRun(stats) {
  const best = loadBest();
  const better = !best || stats.depth > best.depth ||
    (stats.depth === best.depth && stats.kills > best.kills);
  if (better && hasStorage) {
    try {
      localStorage.setItem(BEST_KEY, JSON.stringify({
        depth: stats.depth, kills: stats.kills, archetype: stats.archetype,
      }));
    } catch { /* quota */ }
  }
  return better;
}

// --- daily seed --------------------------------------------------------------

/** Everyone descending today gets the same corridor. */
export function dailySeed(date = new Date()) {
  const key = date.toISOString().slice(0, 10); // YYYY-MM-DD, UTC
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return { seed: h >>> 0, label: key };
}

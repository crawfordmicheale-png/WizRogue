// Vibration feedback for phones. No-op everywhere else, including Node.
import { settings } from '../settings.js';

export function buzz(pattern) {
  if (!settings.haptics) return;
  if (typeof navigator === 'undefined' || !navigator.vibrate) return;
  try { navigator.vibrate(pattern); } catch { /* some browsers throw when hidden */ }
}
